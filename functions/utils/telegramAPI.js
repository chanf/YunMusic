/**
 * Telegram API 封装类
 */
export class TelegramAPI {
    constructor(botToken, proxyUrl = '') {
        this.botToken = botToken;
        this.proxyUrl = proxyUrl;
        // 如果设置了代理域名，使用代理域名，否则使用官方 API
        const apiDomain = proxyUrl ? `https://${proxyUrl}` : 'https://api.telegram.org';
        this.baseURL = `${apiDomain}/bot${this.botToken}`;
        this.fileDomain = proxyUrl ? `https://${proxyUrl}` : 'https://api.telegram.org';
        this.defaultHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0"
        };
    }

    async parseApiError(response) {
        let payload = null;
        try {
            payload = await response.clone().json();
        } catch (_error) {
            payload = null;
        }

        const error = new Error(payload?.description || `Telegram API error: ${response.status} ${response.statusText}`);
        error.status = response.status;
        error.code = payload?.error_code || response.status;
        if (payload?.parameters?.retry_after) {
            error.retryAfterSeconds = payload.parameters.retry_after;
        }
        error.payload = payload;
        return error;
    }

    /**
     * 发送文件到Telegram
     * @param {File} file - 要发送的文件
     * @param {string} chatId - 聊天ID
     * @param {string} functionName - API方法名（如：sendPhoto, sendDocument等）
     * @param {string} functionType - 文件类型参数名（如：photo, document等）
     * @returns {Promise<Object>} API响应结果
     */
    async sendFile(file, chatId, functionName, functionType, caption = '', fileName = '') {
        const formData = new FormData();

        formData.append('chat_id', chatId);
        if (fileName) {
            formData.append(functionType, file, fileName);
        } else {
            formData.append(functionType, file);
        }
        if (caption) {
            formData.append('caption', caption);
        }

        const response = await fetch(`${this.baseURL}/${functionName}`, {
            method: 'POST',
            headers: this.defaultHeaders,
            body: formData
        });
        console.log('Telegram API response:', response.status, response.statusText);
        if (!response.ok) {
            throw await this.parseApiError(response);
        }

        // 解析响应数据
        const responseData = await response.json();

        return responseData;
    }

    /**
     * 发送媒体组（相册）
     * @param {Array<{attachName: string, file: File|Blob, fileName?: string}>} attachments
     * @param {Array<Object>} mediaItems
     * @param {string|number} chatId
     * @returns {Promise<Object>}
     */
    async sendMediaGroup(attachments, mediaItems, chatId) {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('media', JSON.stringify(mediaItems));

        for (const attachment of attachments) {
            if (!attachment?.attachName || !attachment?.file) {
                continue;
            }
            if (attachment.fileName) {
                formData.append(attachment.attachName, attachment.file, attachment.fileName);
            } else {
                formData.append(attachment.attachName, attachment.file);
            }
        }

        const response = await fetch(`${this.baseURL}/sendMediaGroup`, {
            method: 'POST',
            headers: this.defaultHeaders,
            body: formData
        });

        if (!response.ok) {
            throw await this.parseApiError(response);
        }

        return await response.json();
    }

    /**
     * 获取文件信息
     * @param {Object} responseData - Telegram API响应数据
     * @returns {Object|null} 文件信息对象或null
     */
    getFileInfo(responseData) {
        const getFileDetails = (file) => ({
            file_id: file.file_id,
            file_name: file.file_name || file.file_unique_id,
            file_size: file.file_size,
        });

        try {
            if (!responseData.ok) {
                console.error('Telegram API error:', responseData.description);
                return null;
            }

            if (responseData.result.photo) {
                const largestPhoto = responseData.result.photo.reduce((prev, current) =>
                    (prev.file_size > current.file_size) ? prev : current
                );
                return getFileDetails(largestPhoto);
            }

            if (responseData.result.video) {
                return getFileDetails(responseData.result.video);
            }

            if (responseData.result.audio) {
                return getFileDetails(responseData.result.audio);
            }

            if (responseData.result.document) {
                return getFileDetails(responseData.result.document);
            }

            return null;
        } catch (error) {
            console.error('Error parsing Telegram response:', error.message);
            return null;
        }
    }

    /**
     * 从 sendMediaGroup 返回中提取文件信息
     * @param {Object} responseData
     * @returns {Array<{file_id:string, file_name:string, file_size:number, message_id:number, media_group_id:string|null}>}
     */
    getMediaGroupFileInfos(responseData) {
        if (!responseData?.ok || !Array.isArray(responseData.result)) {
            return [];
        }

        const fileInfos = [];
        for (const message of responseData.result) {
            let candidate = null;

            if (Array.isArray(message.photo) && message.photo.length > 0) {
                candidate = message.photo.reduce((prev, current) =>
                    (prev.file_size > current.file_size) ? prev : current
                );
            } else if (message.video) {
                candidate = message.video;
            } else if (message.document) {
                candidate = message.document;
            } else if (message.audio) {
                candidate = message.audio;
            }

            if (!candidate?.file_id) {
                continue;
            }

            fileInfos.push({
                file_id: candidate.file_id,
                file_name: candidate.file_name || candidate.file_unique_id || null,
                file_size: candidate.file_size || 0,
                message_id: message.message_id || null,
                media_group_id: message.media_group_id || null
            });
        }

        return fileInfos;
    }

    /**
     * 获取文件路径
     * @param {string} fileId - 文件ID
     * @returns {Promise<string|null>} 文件路径或null
     */
    async getFilePath(fileId) {
        try {
            const url = `${this.baseURL}/getFile?file_id=${fileId}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: this.defaultHeaders,
            });

            const responseData = await response.json();
            if (responseData.ok) {
                return responseData.result.file_path;
            } else {
                return null;
            }
        } catch (error) {
            console.error('Error getting file path:', error.message);
            return null;
        }
    }

    /**
     * 获取文件内容
     * @param {string} fileId - 文件ID
     * @returns {Promise<Response>} 文件响应
     */
    async getFileContent(fileId) {
        const filePath = await this.getFilePath(fileId);
        if (!filePath) {
            throw new Error(`File path not found for fileId: ${fileId}`);
        }

        const fullURL = `${this.fileDomain}/file/bot${this.botToken}/${filePath}`;
        const response = await fetch(fullURL, {
            headers: this.defaultHeaders
        });

        return response;
    }

}
