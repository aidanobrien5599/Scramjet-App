"use strict";

const form = document.getElementById("sj-form");
const address = document.getElementById("sj-address");
const searchEngine = document.getElementById("sj-search-engine");
const error = document.getElementById("sj-error");
const errorCode = document.getElementById("sj-error-code");

// Detect if we're inside a Scramjet proxy by checking the error stack.
// Stack traces contain real (engine-level) URLs, not Scramjet-wrapped ones.
// If our script URL in the stack contains the proxy prefix, we're nested.
function isProxiedContext() {
	try {
		const stack = new Error().stack || "";
		if (stack.includes("/scramjet/")) return true;
	} catch (e) {}
	return false;
}

const proxied = isProxiedContext();

let scramjet, connection;

if (!proxied) {
	const { ScramjetController } = $scramjetLoadController();

	scramjet = new ScramjetController({
		files: {
			wasm: "/scram/scramjet.wasm.wasm",
			all: "/scram/scramjet.patched.js",
			sync: "/scram/scramjet.sync.js",
		},
	});

	scramjet.init();

	connection = new BareMux.BareMuxConnection("/baremux/worker.js");
}

async function navigate(url) {
	if (proxied) {
		window.location.href = url;
		return;
	}

	try {
		await registerSW();
	} catch (err) {
		error.textContent = "Failed to register service worker.";
		errorCode.textContent = err.toString();
		throw err;
	}

	let wispUrl =
		(location.protocol === "https:" ? "wss" : "ws") +
		"://" +
		location.host +
		"/wisp/";
	if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
		await connection.setTransport("/libcurl/index.mjs", [
			{ websocket: wispUrl },
		]);
	}
	const frame = scramjet.createFrame();
	frame.frame.id = "sj-frame";
	document.body.appendChild(frame.frame);
	frame.go(url);
}

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	const url = search(address.value, searchEngine.value);
	navigate(url);
});

document.querySelectorAll(".quick-link").forEach((link) => {
	link.addEventListener("click", (e) => {
		e.preventDefault();
		const url = link.dataset.url;
		if (url) navigate(url);
	});
});
