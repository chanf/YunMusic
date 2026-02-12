import { userAuthCheck, UnauthorizedResponse } from "../../../utils/userAuth";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, authCode, Range, If-None-Match",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag, Cache-Control",
    "Access-Control-Max-Age": "86400",
};

function appendCorsHeaders(headers) {
    for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
    }
}

function createJsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
        },
    });
}

function buildForwardHeaders(request) {
    const sourceHeaders = request.headers;
    const headers = new Headers();
    const copyKeys = [
        "Range",
        "If-None-Match",
        "If-Modified-Since",
        "Authorization",
        "authCode",
        "Cookie",
        "Referer",
        "User-Agent",
        "Accept",
    ];

    for (const key of copyKeys) {
        const value = sourceHeaders.get(key);
        if (value) {
            headers.set(key, value);
        }
    }

    return headers;
}

function decodeParamId(rawId = "") {
    if (!rawId) {
        return "";
    }

    try {
        return decodeURIComponent(rawId).split(",").join("/");
    } catch (_error) {
        return rawId.split(",").join("/");
    }
}

function encodePathSegments(fileId) {
    return fileId
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        return createJsonResponse({ error: "Method not allowed" }, 405);
    }

    const isAuthenticated = await userAuthCheck(env, url, request, "list");
    if (!isAuthenticated) {
        return UnauthorizedResponse("Unauthorized");
    }

    const fileId = decodeParamId(params?.id || "");
    if (!fileId) {
        return createJsonResponse({ error: "Invalid file id" }, 400);
    }

    const fileUrl = new URL(`/file/${encodePathSegments(fileId)}`, url.origin);
    const authCode = url.searchParams.get("authCode");
    if (authCode) {
        fileUrl.searchParams.set("authCode", authCode);
    }

    let upstreamResponse;
    try {
        upstreamResponse = await fetch(fileUrl.toString(), {
            method: request.method,
            headers: buildForwardHeaders(request),
        });
    } catch (error) {
        return createJsonResponse({
            error: "Failed to stream file",
            detail: error.message,
        }, 502);
    }

    const responseHeaders = new Headers(upstreamResponse.headers);
    appendCorsHeaders(responseHeaders);

    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
    });
}

