import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function getUpstreamApiUrl(): string {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    throw new Error('API_URL is not configured for the web server');
  }

  return apiUrl.replace(/\/$/, '');
}

async function proxyRequest(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  let apiUrl: string;
  try {
    apiUrl = getUpstreamApiUrl();
  } catch (error) {
    console.error(error);
    return Response.json(
      { message: 'API proxy is not configured' },
      { status: 503 },
    );
  }

  const { path } = await context.params;
  const upstreamUrl = new URL(
    `${apiUrl}/${path.map(encodeURIComponent).join('/')}`,
  );
  upstreamUrl.search = request.nextUrl.search;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('connection');
  requestHeaders.delete('content-length');
  requestHeaders.delete('host');
  requestHeaders.set('accept-encoding', 'identity');
  requestHeaders.set('x-forwarded-host', request.nextUrl.host);
  requestHeaders.set(
    'x-forwarded-proto',
    request.nextUrl.protocol.slice(0, -1),
  );

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: requestHeaders,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete('connection');
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('transfer-encoding');

  return new Response(await upstreamResponse.arrayBuffer(), {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const OPTIONS = proxyRequest;
