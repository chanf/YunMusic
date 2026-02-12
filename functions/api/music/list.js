import { userAuthCheck, UnauthorizedResponse } from "../../utils/userAuth";
import { readIndex } from "../../utils/indexManager";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, authCode",
    "Access-Control-Max-Age": "86400",
};

const DEFAULT_COUNT = 50;
const MAX_COUNT = 200;

function createJsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
        },
    });
}

function parseInteger(value, fallback, min = null, max = null) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        return fallback;
    }

    let result = parsed;
    if (min !== null) {
        result = Math.max(min, result);
    }
    if (max !== null) {
        result = Math.min(max, result);
    }

    return result;
}

function normalizeDirectory(inputDir = "") {
    const trimmed = inputDir.trim().replace(/^\/+/, "");
    if (!trimmed) {
        return "";
    }
    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function extractBaseName(path) {
    const normalized = path || "";
    const parts = normalized.split("/");
    return parts[parts.length - 1] || normalized;
}

function stripFileExtension(fileName) {
    const index = fileName.lastIndexOf(".");
    if (index <= 0) {
        return fileName;
    }
    return fileName.slice(0, index);
}

function toSizeBytes(fileMetadata = {}) {
    if (Number.isFinite(Number(fileMetadata.FileSizeBytes))) {
        return Number(fileMetadata.FileSizeBytes);
    }

    if (Number.isFinite(Number(fileMetadata.FileSize))) {
        return Math.round(Number(fileMetadata.FileSize) * 1024 * 1024);
    }

    return null;
}

function encodePathSegments(fileId) {
    return fileId
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

function toTrack(file) {
    const metadata = file.metadata || {};
    const displayName = metadata.FileName || extractBaseName(file.id);
    const title = metadata.TrackTitle || stripFileExtension(displayName);
    const sizeBytes = toSizeBytes(metadata);
    const duration = Number.isFinite(Number(metadata.Duration)) ? Number(metadata.Duration) : null;

    return {
        id: file.id,
        title,
        artist: metadata.Artist || "",
        album: metadata.Album || "",
        duration,
        fileName: displayName,
        fileType: metadata.FileType || "",
        sizeBytes,
        timeStamp: metadata.TimeStamp || 0,
        isChunked: metadata.IsChunked === true,
        streamUrl: `/api/music/stream/${encodePathSegments(file.id)}`,
    };
}

function sortTracks(tracks, sortKey) {
    const sorted = [...tracks];

    switch (sortKey) {
        case "timeAsc":
            sorted.sort((a, b) => (a.timeStamp || 0) - (b.timeStamp || 0));
            break;
        case "nameAsc":
            sorted.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
            break;
        case "nameDesc":
            sorted.sort((a, b) => b.title.localeCompare(a.title, "zh-Hans-CN"));
            break;
        case "sizeAsc":
            sorted.sort((a, b) => (a.sizeBytes || 0) - (b.sizeBytes || 0));
            break;
        case "sizeDesc":
            sorted.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
            break;
        case "timeDesc":
        default:
            sorted.sort((a, b) => (b.timeStamp || 0) - (a.timeStamp || 0));
            break;
    }

    return sorted;
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

    if (request.method !== "GET") {
        return createJsonResponse({ error: "Method not allowed" }, 405);
    }

    const isAuthenticated = await userAuthCheck(env, url, request, "list");
    if (!isAuthenticated) {
        return UnauthorizedResponse("Unauthorized");
    }

    const directory = normalizeDirectory(url.searchParams.get("dir") || "");
    const search = (url.searchParams.get("q") || url.searchParams.get("search") || "").trim();
    const recursive = url.searchParams.get("recursive") === "true";
    const sort = url.searchParams.get("sort") || "timeDesc";

    const start = parseInteger(url.searchParams.get("start"), 0, 0);
    const count = parseInteger(url.searchParams.get("count"), DEFAULT_COUNT, 1, MAX_COUNT);

    const requiresCustomSort = sort !== "timeDesc";
    const readStart = requiresCustomSort ? 0 : start;
    const readCount = requiresCustomSort ? -1 : count;

    const indexResult = await readIndex(context, {
        search,
        directory,
        start: readStart,
        count: readCount,
        includeSubdirFiles: recursive,
        fileType: ["audio"],
        accessStatus: ["normal"],
    });

    if (!indexResult.success) {
        return createJsonResponse({ error: "Failed to read music index" }, 500);
    }

    let tracks = indexResult.files.map(toTrack);
    if (requiresCustomSort) {
        tracks = sortTracks(tracks, sort).slice(start, start + count);
    }

    return createJsonResponse({
        tracks,
        totalCount: indexResult.totalCount,
        returnedCount: tracks.length,
        start,
        count,
        sort,
        recursive,
        directory,
        directories: indexResult.directories || [],
    });
}

