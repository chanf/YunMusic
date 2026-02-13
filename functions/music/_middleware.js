import { userAuthCheck } from "../utils/userAuth";

function isHtmlRequest(request, url) {
    const accept = request.headers.get("Accept") || "";
    return (
        url.pathname === "/music" ||
        url.pathname === "/music/" ||
        url.pathname.endsWith(".html") ||
        accept.includes("text/html")
    );
}

function renderAuthGatePage(url, hasAuthCode) {
    const hint = hasAuthCode
        ? "访问码无效，请重新输入 AUTH_CODE。"
        : "请输入 AUTH_CODE 进入播放器。";

    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YunMusic 认证</title>
  <style>
    body { margin: 0; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif; background:#0f1115; color:#f4f7fb; }
    .wrap { min-height: 100vh; display:flex; align-items:center; justify-content:center; padding:16px; }
    .card { width: 100%; max-width: 420px; background:#181c23; border:1px solid #2b3442; border-radius:14px; padding:20px; }
    h1 { margin:0 0 8px; font-size:20px; }
    p { margin:0 0 14px; color:#9aa5b1; font-size:13px; }
    input, button { width:100%; border-radius:10px; border:1px solid #2b3442; background:#0f1115; color:#f4f7fb; padding:10px 12px; font-size:14px; }
    button { margin-top:10px; background:#4f8cff; border-color:transparent; cursor:pointer; }
    button:hover { background:#2f6ef0; }
    .hint { margin-top:10px; color:#f45f5f; font-size:12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>YunMusic 访问认证</h1>
      <p>${hint}</p>
      <form id="gateForm">
        <input id="authCodeInput" type="password" placeholder="输入 AUTH_CODE" autocomplete="current-password" required>
        <button type="submit">进入播放器</button>
      </form>
      ${hasAuthCode ? '<div class="hint">当前访问码验证失败，请检查后重试。</div>' : ""}
    </div>
  </div>
  <script>
    const form = document.getElementById('gateForm');
    const input = document.getElementById('authCodeInput');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const authCode = input.value.trim();
      if (!authCode) return;
      const target = new URL('${url.origin}/music/');
      target.searchParams.set('authCode', authCode);
      window.location.href = target.toString();
    });
  </script>
</body>
</html>`;

    return new Response(html, {
        status: 401,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

async function requireMusicAuth(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // 放行预检请求
    if (request.method === "OPTIONS") {
        return context.next();
    }

    let isAuthorized = false;
    try {
        isAuthorized = await userAuthCheck(env, url, request, null);
    } catch (_error) {
        isAuthorized = false;
    }

    if (isAuthorized) {
        const response = await context.next();

        // 认证通过时，将 query authCode 写入 Cookie，便于后续直接访问 /music/
        const authCode = url.searchParams.get("authCode");
        if (!authCode) {
            return response;
        }

        const headers = new Headers(response.headers);
        headers.append(
            "Set-Cookie",
            `authCode=${encodeURIComponent(authCode)}; Path=/; Max-Age=2592000; SameSite=Lax`
        );

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    }

    // 未认证：页面请求返回登录页，静态资源直接返回401
    if (isHtmlRequest(request, url)) {
        const hasAuthCode = Boolean(url.searchParams.get("authCode"));
        return renderAuthGatePage(url, hasAuthCode);
    }

    return new Response("Unauthorized", {
        status: 401,
        headers: {
            "Cache-Control": "no-store",
        },
    });
}

export const onRequest = [requireMusicAuth];

