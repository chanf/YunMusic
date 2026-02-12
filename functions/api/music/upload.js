import { userAuthCheck, UnauthorizedResponse } from "../../utils/userAuth";
import { resolveMimeType } from "../../utils/mimeType";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, authCode",
    "Access-Control-Max-Age": "86400",
};

const SUPPORTED_AUDIO_EXTENSIONS = new Set(["mp3", "m4a"]);

function createJsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
        },
    });
}

function getExtension(fileName = "") {
    const index = fileName.lastIndexOf(".");
    if (index < 0 || index === fileName.length - 1) {
        return "";
    }
    return fileName.slice(index + 1).toLowerCase();
}

function normalizeDirectory(inputDir = "") {
    return inputDir.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function encodePathSegments(fileId) {
    return fileId
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

function extractFileIdFromSource(sourceUrl, origin) {
    if (typeof sourceUrl !== "string" || !sourceUrl.trim()) {
        return null;
    }

    let parsed;
    try {
        parsed = new URL(sourceUrl, origin);
    } catch (_error) {
        return null;
    }

    if (!parsed.pathname.startsWith("/file/")) {
        return null;
    }

    const encodedPart = parsed.pathname.slice("/file/".length);
    if (!encodedPart) {
        return null;
    }

    try {
        return decodeURIComponent(encodedPart).split(",").join("/");
    } catch (_error) {
        return encodedPart.split(",").join("/");
    }
}

function isSupportedAudioFile(file) {
    const ext = getExtension(file?.name || "");
    if (!SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
        return false;
    }

    const resolvedMimeType = resolveMimeType(file?.type || "", file?.name || "");
    if (!resolvedMimeType) {
        return false;
    }

    return resolvedMimeType.startsWith("audio/");
}

function pickForwardHeaders(request) {
    const headerKeys = ["Authorization", "authCode", "Cookie", "Referer", "User-Agent"];
    const headers = new Headers();

    for (const key of headerKeys) {
        const value = request.headers.get(key);
        if (value) {
            headers.set(key, value);
        }
    }

    return headers;
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    }

    if (request.method !== "POST") {
        return createJsonResponse({ error: "Method not allowed" }, 405);
    }

    const isAuthenticated = await userAuthCheck(env, url, request, "upload");
    if (!isAuthenticated) {
        return UnauthorizedResponse("Unauthorized");
    }

    let formData;
    try {
        formData = await request.formData();
    } catch (_error) {
        return createJsonResponse({ error: "Invalid form data" }, 400);
    }

    const file = formData.get("file");
    if (!file || typeof file.name !== "string") {
        return createJsonResponse({ error: "file is required" }, 400);
    }

    if (!isSupportedAudioFile(file)) {
        return createJsonResponse({
            error: "Only MP3/M4A audio files are allowed",
        }, 400);
    }

    const uploadUrl = new URL("/upload", url.origin);
    uploadUrl.searchParams.set("uploadChannel", "telegram");
    uploadUrl.searchParams.set("returnFormat", "full");

    const authCode = url.searchParams.get("authCode");
    if (authCode) {
        uploadUrl.searchParams.set("authCode", authCode);
    }

    const channelName = url.searchParams.get("channelName");
    if (channelName) {
        uploadUrl.searchParams.set("channelName", channelName);
    }

    const dir = normalizeDirectory(url.searchParams.get("dir") || "");
    if (dir) {
        uploadUrl.searchParams.set("uploadFolder", dir);
    }

    const forwardHeaders = pickForwardHeaders(request);

    let uploadResponse;
    try {
        uploadResponse = await fetch(uploadUrl.toString(), {
            method: "POST",
            headers: forwardHeaders,
            body: formData,
        });
    } catch (error) {
        return createJsonResponse({
            error: "Upload request failed",
            detail: error.message,
        }, 502);
    }

    const responseText = await uploadResponse.text();
    let uploadPayload;
    try {
        uploadPayload = JSON.parse(responseText);
    } catch (_error) {
        uploadPayload = responseText;
    }

    if (!uploadResponse.ok) {
        return createJsonResponse({
            error: "Upload failed",
            detail: uploadPayload,
        }, uploadResponse.status);
    }

    const source = Array.isArray(uploadPayload) ? uploadPayload[0]?.src : null;
    if (typeof source !== "string") {
        return createJsonResponse({
            success: true,
            result: uploadPayload,
        });
    }

    const fileId = extractFileIdFromSource(source, url.origin);
    const fileUrl = new URL(source, url.origin).toString();

    if (!fileId) {
        return createJsonResponse({
            success: true,
            fileUrl,
            result: uploadPayload,
        });
    }

    return createJsonResponse({
        success: true,
        fileId,
        fileUrl,
        streamUrl: `/api/music/stream/${encodePathSegments(fileId)}`,
    });
}

