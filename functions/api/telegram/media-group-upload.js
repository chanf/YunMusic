import { fetchUploadConfig, fetchSecurityConfig } from '../../utils/sysConfig.js';
import { getDatabase } from '../../utils/databaseAdapter.js';
import { resolveMimeType } from '../../utils/mimeType.js';
import {
    buildUniqueFileId,
    endUpload,
    getUploadIp,
    getIPAddress,
    moderateContent,
    getImageDimensions
} from '../../upload/uploadTools.js';
import { userAuthCheck } from '../../utils/userAuth.js';
import { TelegramAPI } from '../../utils/telegramAPI.js';

const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_TOTAL_SIZE = 80 * 1024 * 1024;
const DEFAULT_MAX_SINGLE_FILE_SIZE = 20 * 1024 * 1024;

function createApiError(code, message, status = 500, extra = {}) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    Object.assign(error, extra);
    return error;
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, authCode'
        }
    });
}

function parseLimit(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeUploadFolder(uploadFolder) {
    if (uploadFolder === null || uploadFolder === undefined) {
        return '';
    }

    const normalized = String(uploadFolder)
        .trim()
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\/{2,}/g, '/');

    if (!normalized) {
        return '';
    }

    const segments = normalized.split('/');
    for (const segment of segments) {
        if (!segment || segment === '.' || segment === '..') {
            throw createApiError('INVALID_REQUEST', 'Invalid uploadFolder: contains illegal path segment', 400);
        }
        if (segment.startsWith('manage@')) {
            throw createApiError('INVALID_REQUEST', 'Invalid uploadFolder: reserved segment name', 400);
        }
    }

    return normalized;
}

function normalizeFileName(name) {
    if (typeof name !== 'string') {
        throw createApiError('INVALID_REQUEST', 'File name must be a string', 400);
    }

    const trimmed = name.trim();
    if (!trimmed) {
        throw createApiError('INVALID_REQUEST', 'File name cannot be empty', 400);
    }
    if (trimmed.length > 255) {
        throw createApiError('INVALID_REQUEST', 'File name is too long', 400);
    }
    if (trimmed === '.' || trimmed === '..') {
        throw createApiError('INVALID_REQUEST', 'File name cannot be . or ..', 400);
    }
    if (trimmed.includes('/') || trimmed.includes('\\')) {
        throw createApiError('INVALID_REQUEST', 'File name cannot contain path separators', 400);
    }
    if (trimmed.startsWith('manage@')) {
        throw createApiError('INVALID_REQUEST', 'File name cannot use reserved prefix', 400);
    }

    return trimmed;
}

function normalizeContentBase64(contentBase64) {
    if (typeof contentBase64 !== 'string' || !contentBase64.trim()) {
        throw createApiError('INVALID_REQUEST', 'contentBase64 is required', 400);
    }

    const value = contentBase64.trim();
    const commaIndex = value.indexOf(',');
    const rawBase64 = value.startsWith('data:') && commaIndex !== -1
        ? value.slice(commaIndex + 1)
        : value;

    return rawBase64.replace(/\s+/g, '');
}

function estimateBase64Size(base64Data) {
    const len = base64Data.length;
    if (len === 0) {
        return 0;
    }

    const padding = base64Data.endsWith('==') ? 2 : base64Data.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

function decodeBase64ToUint8Array(base64Data) {
    let binary;
    try {
        binary = atob(base64Data);
    } catch (_error) {
        throw createApiError('INVALID_REQUEST', 'Invalid base64 content', 400);
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function encodeFileIdForUrl(fileId) {
    return fileId
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

function selectTelegramChannel(tgSettings, channelName = null) {
    const channels = tgSettings?.channels || [];
    if (channels.length === 0) {
        return null;
    }

    if (channelName) {
        return channels.find(channel => channel.name === channelName) || null;
    }

    return tgSettings.loadBalance?.enabled
        ? channels[Math.floor(Math.random() * channels.length)]
        : channels[0];
}

function detectMediaType(mimeType) {
    const normalized = String(mimeType || '').toLowerCase();

    if (normalized.startsWith('image/')) {
        if (normalized === 'image/gif' || normalized === 'image/webp' || normalized === 'image/svg+xml' || normalized === 'image/x-icon') {
            throw createApiError('INVALID_REQUEST', `Unsupported image type for media group: ${mimeType}`, 400);
        }
        return 'photo';
    }

    if (normalized.startsWith('video/')) {
        return 'video';
    }

    if (normalized.startsWith('audio/')) {
        return 'audio';
    }

    return 'document';
}

function validateMediaGroupTypes(preparedFiles) {
    const hasAudio = preparedFiles.some(file => file.mediaType === 'audio');
    const hasDocument = preparedFiles.some(file => file.mediaType === 'document');

    if (hasAudio && preparedFiles.some(file => file.mediaType !== 'audio')) {
        throw createApiError('INVALID_REQUEST', 'Audio albums can only contain audio files', 400);
    }

    if (hasDocument && preparedFiles.some(file => file.mediaType !== 'document')) {
        throw createApiError('INVALID_REQUEST', 'Document albums can only contain document files', 400);
    }
}

function toErrorResponse(error) {
    const errorCode = error?.code;
    const status = error?.status;

    if (errorCode === 'INVALID_REQUEST') {
        return jsonResponse({
            success: false,
            code: 'INVALID_REQUEST',
            error: error.message
        }, status || 400);
    }

    if (errorCode === 'CHANNEL_NOT_FOUND') {
        return jsonResponse({
            success: false,
            code: 'CHANNEL_NOT_FOUND',
            error: error.message
        }, status || 400);
    }

    if (status === 429) {
        return jsonResponse({
            success: false,
            code: 'RATE_LIMIT',
            error: error.message,
            retryAfterSeconds: error.retryAfterSeconds || null
        }, 429);
    }

    if (status === 401 || status === 403) {
        return jsonResponse({
            success: false,
            code: 'AUTH_ERROR',
            error: error.message
        }, 401);
    }

    if (errorCode === 'TELEGRAM_API_ERROR') {
        return jsonResponse({
            success: false,
            code: 'TELEGRAM_API_ERROR',
            error: error.message,
            details: error.rawError || null
        }, status || 502);
    }

    return jsonResponse({
        success: false,
        code: 'INTERNAL_ERROR',
        error: error?.message || 'Unknown error'
    }, 500);
}

export async function onRequestOptions() {
    return jsonResponse({ success: true }, 200);
}

export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    const url = new URL(request.url);
    context.url = url;

    const maxFiles = Math.min(10, Math.max(2, parseLimit(env.TG_MEDIA_GROUP_MAX_FILES, DEFAULT_MAX_FILES)));
    const maxTotalSize = parseLimit(env.TG_MEDIA_GROUP_MAX_TOTAL_SIZE, DEFAULT_MAX_TOTAL_SIZE);
    const maxSingleFileSize = parseLimit(env.TG_MEDIA_GROUP_MAX_SINGLE_FILE_SIZE, DEFAULT_MAX_SINGLE_FILE_SIZE);

    try {
        const requiredPermission = 'upload';
        if (!await userAuthCheck(env, url, request, requiredPermission)) {
            return jsonResponse({
                success: false,
                code: 'AUTH_ERROR',
                error: 'Unauthorized'
            }, 401);
        }

        let body;
        try {
            body = await request.json();
        } catch (_error) {
            return jsonResponse({
                success: false,
                code: 'INVALID_REQUEST',
                error: 'Request body must be valid JSON'
            }, 400);
        }

        const {
            uploadFolder = '',
            channelName = null,
            requestId = null,
            files
        } = body || {};

        if (!Array.isArray(files) || files.length < 2) {
            return jsonResponse({
                success: false,
                code: 'INVALID_REQUEST',
                error: 'files must be an array with at least 2 items'
            }, 400);
        }

        if (files.length > maxFiles) {
            return jsonResponse({
                success: false,
                code: 'INVALID_REQUEST',
                error: `Too many files, max allowed: ${maxFiles}`
            }, 400);
        }

        if (requestId !== null && requestId !== undefined) {
            if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 128) {
                return jsonResponse({
                    success: false,
                    code: 'INVALID_REQUEST',
                    error: 'requestId must be a non-empty string up to 128 chars'
                }, 400);
            }
        }

        const normalizedFolder = normalizeUploadFolder(uploadFolder);
        if (normalizedFolder) {
            url.searchParams.set('uploadFolder', normalizedFolder);
        }

        const db = getDatabase(env);
        const idempotencyKey = requestId ? `manage@tg_media_group_request@${requestId}` : null;
        if (idempotencyKey) {
            const existing = await db.get(idempotencyKey);
            if (existing) {
                let payload;
                try {
                    payload = JSON.parse(existing);
                } catch (_error) {
                    payload = null;
                }

                if (!payload || typeof payload !== 'object') {
                    await db.delete(idempotencyKey);
                } else {
                    payload.idempotent = true;
                    return jsonResponse(payload, 200);
                }
            }
        }

        const uploadConfig = await fetchUploadConfig(env, context);
        const tgSettings = uploadConfig?.telegram;
        if (!tgSettings || !Array.isArray(tgSettings.channels) || tgSettings.channels.length === 0) {
            throw createApiError('CHANNEL_NOT_FOUND', 'No Telegram channel configured', 400);
        }

        const tgChannel = selectTelegramChannel(tgSettings, channelName);
        if (!tgChannel) {
            throw createApiError('CHANNEL_NOT_FOUND', channelName
                ? `Telegram channel not found: ${channelName}`
                : 'No available Telegram channel', 400);
        }

        if (!tgChannel.botToken || !tgChannel.chatId) {
            throw createApiError('CHANNEL_NOT_FOUND', 'Telegram channel not properly configured', 400);
        }

        const tgBotToken = tgChannel.botToken;
        const tgChatId = tgChannel.chatId;
        const tgProxyUrl = tgChannel.proxyUrl || '';

        const uploadIp = getUploadIp(request);
        const uploadAddress = await getIPAddress(uploadIp);

        let totalEstimatedBytes = 0;
        const preparedFiles = [];
        const now = Date.now();

        for (let i = 0; i < files.length; i++) {
            const fileInput = files[i] || {};
            const fileName = normalizeFileName(fileInput.name);
            const mimeType = resolveMimeType(fileInput.mimeType, fileName, {
                dataUrlValue: fileInput.contentBase64
            });
            const base64Data = normalizeContentBase64(fileInput.contentBase64);
            const estimatedSize = estimateBase64Size(base64Data);

            if (estimatedSize <= 0) {
                throw createApiError('INVALID_REQUEST', `files[${i}] has empty content`, 400);
            }
            if (estimatedSize > maxSingleFileSize) {
                throw createApiError('INVALID_REQUEST', `files[${i}] exceeds max single file size limit (${maxSingleFileSize} bytes)`, 400);
            }

            totalEstimatedBytes += estimatedSize;
            if (totalEstimatedBytes > maxTotalSize) {
                throw createApiError('INVALID_REQUEST', `Total files size exceeds limit (${maxTotalSize} bytes)`, 400);
            }

            const mediaType = detectMediaType(mimeType);
            const bytes = decodeBase64ToUint8Array(base64Data);
            const file = new File([bytes], fileName, { type: mimeType });
            const fullId = await buildUniqueFileId(context, fileName, mimeType);

            let imageDimensions = null;
            if (mimeType.startsWith('image/')) {
                try {
                    const headerArray = bytes.length > 65536 ? bytes.slice(0, 65536) : bytes;
                    imageDimensions = getImageDimensions(headerArray.buffer, mimeType);
                } catch (error) {
                    console.warn(`Failed to parse image dimensions for ${fileName}:`, error.message);
                }
            }

            const metadata = {
                FileName: fileName,
                FileType: mimeType,
                FileSize: (file.size / 1024 / 1024).toFixed(2),
                FileSizeBytes: file.size,
                UploadIP: uploadIp,
                UploadAddress: uploadAddress,
                ListType: 'None',
                TimeStamp: now,
                Label: 'None',
                Directory: normalizedFolder === '' ? '' : `${normalizedFolder}/`,
                Tags: []
            };

            if (imageDimensions) {
                metadata.Width = imageDimensions.width;
                metadata.Height = imageDimensions.height;
            }

            preparedFiles.push({
                index: i,
                name: fileName,
                file,
                mimeType,
                mediaType,
                caption: typeof fileInput.caption === 'string' ? fileInput.caption : '',
                fullId,
                metadata
            });
        }

        validateMediaGroupTypes(preparedFiles);

        const telegramAPI = new TelegramAPI(tgBotToken, tgProxyUrl);
        const attachments = [];
        const mediaItems = [];

        for (const file of preparedFiles) {
            const attachName = `file_${file.index}`;
            attachments.push({
                attachName,
                file: file.file,
                fileName: file.name
            });

            const mediaItem = {
                type: file.mediaType,
                media: `attach://${attachName}`
            };

            if (file.caption) {
                mediaItem.caption = file.caption;
            }

            mediaItems.push(mediaItem);
        }

        let sendResult;
        try {
            sendResult = await telegramAPI.sendMediaGroup(attachments, mediaItems, tgChatId);
        } catch (error) {
            if (error?.status === 429) {
                throw createApiError('RATE_LIMIT', error.message, 429, {
                    retryAfterSeconds: error.retryAfterSeconds || null
                });
            }

            throw createApiError('TELEGRAM_API_ERROR', error.message, 502, {
                rawError: error?.payload || null
            });
        }

        const mediaGroupFileInfos = telegramAPI.getMediaGroupFileInfos(sendResult);
        if (mediaGroupFileInfos.length !== preparedFiles.length) {
            throw createApiError('TELEGRAM_API_ERROR', 'Telegram returned unexpected media group result count', 502, {
                rawError: sendResult
            });
        }

        const securityConfig = await fetchSecurityConfig(env);
        const moderateEnabled = securityConfig?.upload?.moderate?.enabled === true;
        const moderateDomain = tgProxyUrl ? `https://${tgProxyUrl}` : 'https://api.telegram.org';

        const responseFiles = [];
        for (let i = 0; i < preparedFiles.length; i++) {
            const file = preparedFiles[i];
            const info = mediaGroupFileInfos[i];

            if (!info?.file_id) {
                throw createApiError('TELEGRAM_API_ERROR', `Telegram missing file_id for media index ${i}`, 502, {
                    rawError: sendResult
                });
            }

            const filePath = await telegramAPI.getFilePath(info.file_id);
            if (!filePath) {
                throw createApiError('TELEGRAM_API_ERROR', `Failed to resolve Telegram file path for media index ${i}`, 502);
            }

            const metadata = file.metadata;
            if (info.file_size) {
                metadata.FileSize = (info.file_size / 1024 / 1024).toFixed(2);
                metadata.FileSizeBytes = info.file_size;
            }

            metadata.Channel = 'TelegramNew';
            metadata.ChannelName = tgChannel.name || 'Telegram_env';
            metadata.TgFileId = info.file_id;
            metadata.TgChatId = tgChatId;
            metadata.TgBotToken = tgBotToken;
            metadata.TgMessageId = info.message_id || null;
            metadata.TgMediaGroupId = info.media_group_id || null;
            if (tgProxyUrl) {
                metadata.TgProxyUrl = tgProxyUrl;
            }

            if (moderateEnabled) {
                const moderateUrl = `${moderateDomain}/file/bot${tgBotToken}/${filePath}`;
                try {
                    metadata.Label = await moderateContent(env, moderateUrl);
                } catch (error) {
                    console.warn(`Moderation failed for ${file.fullId}:`, error.message);
                }
            }

            await db.put(file.fullId, '', { metadata });
            waitUntil(endUpload(context, file.fullId, metadata));

            responseFiles.push({
                name: file.name,
                src: `/file/${encodeFileIdForUrl(file.fullId)}`,
                fullId: file.fullId,
                messageId: info.message_id || null
            });
        }

        const payload = {
            success: true,
            requestId: requestId || null,
            channelName: tgChannel.name || null,
            mediaGroupId: mediaGroupFileInfos[0]?.media_group_id || null,
            files: responseFiles
        };

        if (idempotencyKey) {
            await db.put(idempotencyKey, JSON.stringify(payload));
        }

        return jsonResponse(payload, 200);
    } catch (error) {
        console.error('telegram media-group-upload error:', error.message);
        return toErrorResponse(error);
    }
}
