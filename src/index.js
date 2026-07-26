import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { hostname } from "node:os";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));
const scramjetLocalPath = fileURLToPath(new URL("../public/scram/", import.meta.url));

// Wisp Configuration: Refer to the documentation at https://www.npmjs.com/package/@mercuryworkshop/wisp-js

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
	allow_udp_streams: false,
	hostname_blacklist: [/example\.com/],
	dns_servers: ["1.1.1.3", "1.0.0.3"],
});

const fastify = Fastify({
	serverFactory: (handler) => {
		return createServer()
			.on("request", (req, res) => {
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
				handler(req, res);
			})
			.on("upgrade", (req, socket, head) => {
				if (req.url.endsWith("/wisp/")) wisp.routeRequest(req, socket, head);
				else socket.end();
			});
	},
});

fastify.register(fastifyStatic, {
	root: publicPath,
	decorateReply: true,
});

fastify.register(fastifyStatic, {
	root: scramjetLocalPath,
	prefix: "/scram/",
	decorateReply: false,
	cacheControl: false,
	setHeaders: (res) => {
		res.setHeader("Cache-Control", "no-cache");
	},
});

fastify.register(fastifyStatic, {
	root: libcurlPath,
	prefix: "/libcurl/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: baremuxPath,
	prefix: "/baremux/",
	decorateReply: false,
});

fastify.get("/scramjet/*", (req, reply) => {
	const encoded = req.url.replace("/scramjet/", "");
	const targetUrl = decodeURIComponent(encoded);
	reply.type("text/html").send(`<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Loading...</title>
<script src="/scram/scramjet.patched.js"></script>
<script src="/baremux/index.js"></script>
<script>
const TARGET = ${JSON.stringify(targetUrl)};
(async () => {
	try {
		await navigator.serviceWorker.register("/sw.js");
		const { ScramjetController } = $scramjetLoadController();
		const scramjet = new ScramjetController({
			files: { wasm: "/scram/scramjet.wasm.wasm", all: "/scram/scramjet.patched.js", sync: "/scram/scramjet.sync.js" }
		});
		await scramjet.init();
		const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
		const wispUrl = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";
		if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
			await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
		}
		const frame = scramjet.createFrame();
		frame.frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:none;z-index:1";
		document.body.appendChild(frame.frame);
		frame.go(TARGET);
	} catch (err) {
		document.getElementById("msg").textContent = "Failed to load: " + err.message;
	}
})();
</script>
<style>
body { background:#1C1C1C; color:#888; font-family:monospace; margin:0; }
#loader { display:flex; align-items:center; justify-content:center; height:100vh; }
</style>
</head><body>
<div id="loader"><p id="msg">Loading...</p></div>
</body></html>`);
});

fastify.setNotFoundHandler((res, reply) => {
	return reply.code(404).type("text/html").sendFile("404.html");
});

fastify.server.on("listening", () => {
	const address = fastify.server.address();

	// by default we are listening on 0.0.0.0 (every interface)
	// we just need to list a few
	console.log("Listening on:");
	console.log(`\thttp://localhost:${address.port}`);
	console.log(`\thttp://${hostname()}:${address.port}`);
	console.log(
		`\thttp://${
			address.family === "IPv6" ? `[${address.address}]` : address.address
		}:${address.port}`
	);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	console.log("SIGTERM signal received: closing HTTP server");
	fastify.close();
	process.exit(0);
}

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080;

fastify.listen({
	port: port,
	host: "0.0.0.0",
});
