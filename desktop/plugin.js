import { Button, COMPOSER_AREAS, Codicon, EmptyState, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, SIDEBAR_NAV_PREFS_AREA, StatusDot, Tip, atom, cn, host, queryClient, useMutation, useQuery, useQueryClient, useValue } from "@hermes/plugin-sdk";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
// src/icons.ts
/** The icons an app may wear: codicons, which Desktop loads in full, picked for apps. Keep in step with
*  server/hermes-plugin-freya/icons.py's ICONS, which checks a pick, and the iPhone's AppIcons.swift. */
var APP_ICONS = [
	"person",
	"account",
	"organization",
	"mention",
	"comment-discussion",
	"mail",
	"inbox",
	"call-outgoing",
	"megaphone",
	"bell",
	"rss",
	"broadcast",
	"radio-tower",
	"calendar",
	"clock",
	"history",
	"milestone",
	"checklist",
	"tasklist",
	"target",
	"flag",
	"note",
	"notebook",
	"pencil",
	"book",
	"folder-library",
	"file-text",
	"files",
	"archive",
	"bookmark",
	"tag",
	"repo",
	"package",
	"briefcase",
	"credit-card",
	"percentage",
	"dashboard",
	"graph",
	"graph-line",
	"pie-chart",
	"pulse",
	"table",
	"database",
	"home",
	"globe",
	"map",
	"location",
	"compass",
	"telescope",
	"coffee",
	"game",
	"jersey",
	"smiley",
	"thumbsup",
	"heart",
	"gift",
	"mortar-board",
	"music",
	"piano",
	"mic",
	"play-circle",
	"device-camera",
	"device-camera-video",
	"file-media",
	"symbol-color",
	"paintcan",
	"sparkle",
	"wand",
	"lightbulb",
	"thinking",
	"beaker",
	"microscope",
	"rocket",
	"flame",
	"star-full",
	"zap",
	"code",
	"terminal",
	"git-branch",
	"extensions",
	"tools",
	"gear",
	"layers",
	"server",
	"chip",
	"cloud",
	"plug",
	"keyboard",
	"device-desktop",
	"device-mobile",
	"link",
	"sync",
	"search",
	"eye",
	"bug",
	"shield",
	"lock",
	"key",
	"verified"
];
/** The colors an app's icon may wear, by name: Desktop's project swatches, hsl(i*30 68% 58%) for the i-th. Keep in step
*  with icons.py's COLORS. */
var APP_COLORS = [
	"red",
	"orange",
	"yellow",
	"lime",
	"green",
	"mint",
	"teal",
	"sky",
	"blue",
	"purple",
	"magenta",
	"pink"
];
/** The codicon for an app: its icon, or the generic app glyph when it has none (or one this build doesn't know). */
function appCodicon(app) {
	return app.icon && APP_ICONS.includes(app.icon) ? app.icon : "browser";
}
/** The CSS color for an app's icon, or undefined for the text color around it. */
function appTint(app) {
	const i = APP_COLORS.indexOf(app.color ?? "");
	return i < 0 ? void 0 : `hsl(${i * 30} 68% 58%)`;
}
// src/freya.ts
/** The server has no Freya plugin, or one too old for what was asked. */
var PluginMissing = class extends Error {
	needsUpdate;
	constructor(needsUpdate = false) {
		super(needsUpdate ? "The Freya plugin on this server needs an update" : "The Freya plugin isn’t on this server");
		this.needsUpdate = needsUpdate;
	}
};
var utility = null;
var creating = null;
/** Run a slash command on a prompt-less utility session (it never becomes a stored session). The gateway reaps an
*  idle session, and a reconnect drops it: then the command fails, so make a new one and try once more, rather than
*  failing the page until its next poll. */
async function slash(command) {
	for (let attempt = 0;; attempt++) {
		const profile = host.state.profile.get();
		if (utility?.profile !== profile) {
			if (creating?.profile !== profile) creating = {
				profile,
				done: host.request("session.create", { source: "desktop" })
			};
			const pending = creating;
			try {
				utility = {
					profile,
					id: (await pending.done).session_id
				};
			} finally {
				if (creating === pending) creating = null;
			}
		}
		try {
			return (await host.request("slash.exec", {
				session_id: utility.id,
				command
			})).output ?? "";
		} catch (error) {
			utility = null;
			if (attempt > 0) throw error;
		}
	}
}
/** The last answer for a page, kept on this Mac per profile, to show at once while the current one loads. */
function remember(name, value) {
	try {
		localStorage.setItem(`freya:${name}:${host.state.profile.get()}`, JSON.stringify(value));
	} catch {}
	return value;
}
function recall(name, profile) {
	try {
		return JSON.parse(localStorage.getItem(`freya:${name}:${profile}`) || "null") ?? void 0;
	} catch {
		return;
	}
}
/** The plugin's slash command. Freya's plugin answers /talaria as well as /freya, and a server that hasn't moved
*  from talaria yet answers only /talaria, so Desktop asks by the old name and works with both. */
var CMD = "talaria";
async function slashJSON(command, needsUpdate = false) {
	const out = await slash(command);
	try {
		return JSON.parse(out);
	} catch {
		throw new PluginMissing(needsUpdate && /usage: \/(freya|talaria)/.test(out));
	}
}
/** Freya's Desktop half is on: Talaria's Desktop plugin from before the rename can go, where it's on the same machine
*  as the server (the plugin's `desktop-on`). A server elsewhere, or from before it, changes nothing. */
async function retireTalaria() {
	try {
		await slash(`${CMD} desktop-on`);
	} catch {}
}
async function inbox() {
	return remember("inbox", (await slashJSON(`${CMD} inbox --json`)).rows);
}
/** Hide a session's row on the server, for every device, until its next turn. Names the turn the row
*  showed, so a click on a stale row doesn't hide a turn that finished since; a plugin from before
*  0.6 answers that in words, and gets the old form. */
async function dismiss(row) {
	if (row.turn_id && (await slash(`${CMD} dismiss ${row.session_id} ${row.turn_id}`)).includes("\"dismissed\"")) return;
	await slash(`${CMD} dismiss ${row.session_id}`);
}
async function apps() {
	const answer = await slashJSON(`${CMD} apps`, true);
	remember("app-kit", {
		icons: answer.icons,
		colors: answer.colors
	});
	return remember("apps", answer.apps);
}
/** Pick an app's icon on the box, for every device; `none` goes back to its own. */
async function setAppIcon(name, icon) {
	const answer = await slashJSON(`${CMD} app-icon ${name} ${icon}`, true);
	if (answer.error) throw new Error(answer.error);
}
/** An app's own image, as a data URL, for an icon that's fully custom. */
async function appImage(name) {
	const answer = await slashJSON(`${CMD} app-image ${name}`, true);
	if (answer.error || !answer.data) throw new Error(answer.error ?? "No image");
	return `data:${answer.type};base64,${answer.data}`;
}
/** Pick the color of an app's icon on the box, for every device; `none` goes back to the text color. */
async function setAppColor(name, color) {
	const answer = await slashJSON(`${CMD} app-color ${name} ${color}`, true);
	if (answer.error) throw new Error(answer.error);
}
/** Pin an app to the sidebar, or unpin it, on every device. */
async function setAppPinned(name, pinned) {
	const answer = await slashJSON(`${CMD} ${pinned ? "pin" : "unpin"} ${name}`, true);
	if (answer.error) throw new Error(answer.error);
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** `/talaria open`, asked again while the server is still starting (npm install, Vite's first scan). */
async function open(name, via) {
	const command = via ? `${CMD} open ${name} --via ${via}` : `${CMD} open ${name}`;
	for (let i = 0; i < 120; i++) {
		const opened = await slashJSON(command, true);
		if (opened.state === "starting") {
			await sleep(1e3);
			continue;
		}
		if (opened.error || opened.state === "failed" || !opened.port) throw new Error(opened.error || `Couldn’t open ${name}`);
		return {
			...opened,
			port: opened.port,
			path: opened.path ?? "/"
		};
	}
	throw new Error(`${name} is taking too long to start.`);
}
/** The gateway's host when Desktop reaches it over the network (an http:// or https:// connection), else null: the
*  backend is on this Mac, or reached over SSH, which Desktop forwards. */
async function remoteHost() {
	try {
		const rows = await host.connections();
		const id = host.activeConnectionId();
		const row = rows.find((r) => r.id === id) ?? (id ? void 0 : rows.find((r) => r.primary));
		if (row?.kind !== "remote" || !row.url) return null;
		const name = new URL(row.url).hostname;
		return [
			"localhost",
			"127.0.0.1",
			"[::1]",
			"::1"
		].includes(name) ? null : name;
	} catch {
		return null;
	}
}
/** The backend serves the app on a loopback port (`/talaria open`): the workspace's dev server, every app at
*  /<app>/, or an older app's own port. Locally that's reachable as is; over SSH Desktop forwards it. On a direct
*  connection (no SSH to forward through) the plugin opens a gate on the gateway's own host and hands back a ticket
*  that lets this Mac in. */
async function appURL(name) {
	const via = await remoteHost();
	if (!via) {
		const opened = await open(name);
		const loopback = `http://127.0.0.1:${opened.port}${opened.path}`;
		const reach = window.hermesDesktop?.reachPreviewUrl;
		return {
			src: reach ? await reach(loopback) : loopback,
			ticketed: false
		};
	}
	const gated = await open(name, via);
	if (!gated.ticket) throw new Error(`${displayName({
		name,
		folder: "",
		updated: 0
	})} is an older app, with its own index.html, and opens only over SSH. Rebuilt as an App.tsx app, it opens on any connection.`);
	return {
		src: `http://${via.includes(":") ? `[${via}]` : via}:${gated.port}${gated.path}?talaria-ticket=${encodeURIComponent(gated.ticket)}`,
		ticketed: true
	};
}
/** "weekly-budget" → "Weekly budget", for an app whose page has no title. */
function displayName(app) {
	if (app.title) return app.title;
	const words = app.name.replace(/[-_]/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}
/** "now", "5m", "3h", "2d": how long ago, as the iPhone app's rows say it. */
function ago(when) {
	if (when == null) return "";
	const ms = typeof when === "number" ? when * 1e3 : Date.parse(when);
	if (Number.isNaN(ms)) return "";
	const s = Math.max(0, (Date.now() - ms) / 1e3);
	if (s < 60) return "now";
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}
// src/ui.tsx
/** A Freya page: a title with a count and a refresh, then a scrolling body. */
function Page(props) {
	return /* @__PURE__ */ jsxs("main", {
		className: "flex h-full min-h-0 flex-col",
		children: [/* @__PURE__ */ jsxs("header", {
			className: "flex shrink-0 items-center gap-2 px-5 pt-4 pb-2",
			children: [
				/* @__PURE__ */ jsx("h1", {
					className: "text-base font-semibold",
					children: props.title
				}),
				props.count ? /* @__PURE__ */ jsx("span", {
					className: "text-xs tabular-nums text-(--ui-text-tertiary)",
					children: props.count
				}) : null,
				/* @__PURE__ */ jsx("div", { className: "flex-1" }),
				props.onRefresh && /* @__PURE__ */ jsx(Tip, {
					label: "Refresh",
					children: /* @__PURE__ */ jsx(Button, {
						"aria-label": "Refresh",
						onClick: props.onRefresh,
						size: "icon-xs",
						variant: "ghost",
						children: /* @__PURE__ */ jsx(Codicon, {
							className: cn(props.refreshing && "animate-spin"),
							name: "refresh"
						})
					})
				})
			]
		}), /* @__PURE__ */ jsx("div", {
			className: "min-h-0 flex-1 overflow-auto px-3 pb-6",
			children: props.children
		})]
	});
}
function Section(props) {
	if (!props.count) return null;
	return /* @__PURE__ */ jsxs("section", {
		className: "mt-3",
		children: [/* @__PURE__ */ jsxs("h2", {
			className: "px-2 pb-1 text-[0.6875rem] font-medium tracking-wide text-(--ui-text-tertiary) uppercase",
			children: [
				props.title,
				" · ",
				props.count
			]
		}), /* @__PURE__ */ jsx("ul", { children: props.children })]
	});
}
/** A list row: a leading mark, a title over one line of detail, and a trailing note. */
function Row(props) {
	const body = /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsx("span", {
			className: "flex w-3 shrink-0 justify-center",
			children: props.lead
		}),
		/* @__PURE__ */ jsxs("span", {
			className: "min-w-0 flex-1",
			children: [/* @__PURE__ */ jsx("span", {
				className: "block truncate text-sm",
				children: props.title
			}), props.detail && /* @__PURE__ */ jsx("span", {
				className: "block truncate text-xs text-(--ui-text-secondary)",
				children: props.detail
			})]
		}),
		props.trailing && /* @__PURE__ */ jsx("span", {
			className: "shrink-0 text-xs tabular-nums text-(--ui-text-tertiary)",
			children: props.trailing
		})
	] });
	return /* @__PURE__ */ jsxs("li", {
		className: "group flex items-center rounded-[4px] hover:bg-(--chrome-action-hover)",
		children: [props.onClick ? /* @__PURE__ */ jsx("button", {
			className: "flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left",
			onClick: props.onClick,
			type: "button",
			children: body
		}) : /* @__PURE__ */ jsx("div", {
			className: "flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5",
			children: body
		}), props.actions && /* @__PURE__ */ jsx("span", {
			className: "flex shrink-0 pr-1 opacity-0 group-hover:opacity-100",
			children: props.actions
		})]
	});
}
/** Loading, a missing server plugin, or another failure, in place of a page's list. */
function Status(props) {
	if (props.loading) return /* @__PURE__ */ jsx(EmptyState, { title: "Loading…" });
	if (props.error instanceof PluginMissing) return /* @__PURE__ */ jsx(EmptyState, {
		description: props.error.needsUpdate ? `${props.feature} needs a newer Freya plugin (server/plugin.sh deploy). If it's deployed already, the backend Desktop uses started before that and needs a restart.` : `${props.feature} needs the Freya plugin on this Hermes server (server/plugin.sh deploy), then a backend restart.`,
		title: props.error.message
	});
	if (props.error) return /* @__PURE__ */ jsx(EmptyState, {
		description: String(props.error.message ?? props.error),
		title: "Couldn’t load"
	});
	return null;
}
// src/pages/apps.tsx
/** The app open on the page, if any. Kept outside the page so leaving Apps and coming back returns to it. */
var $open = atom(null);
var appsQueryKey = (profile) => [
	"freya",
	profile,
	"apps"
];
/** The app page shared with Hermes, for the composer's chip: the newest one an AppView shares, and how to stop. */
var $shared = atom(null);
/** Above the composer while an app page is shared: what Hermes is told you're looking at, each message (the
*  plugin's pre_llm_call adds what the page shows). × stops sharing it; the eye, or Chat about this page, shares
*  it again. */
function SharedChip() {
	const shared = useValue($shared);
	if (!shared) return null;
	const where = [displayName(shared.app), shared.page].filter(Boolean).join(" · ");
	return /* @__PURE__ */ jsx("div", {
		className: "flex",
		children: /* @__PURE__ */ jsx(Tip, {
			label: "Hermes is told what this page shows with each message",
			children: /* @__PURE__ */ jsxs("span", {
				className: "inline-flex max-w-full items-center gap-1.5 rounded-full border border-(--ui-stroke-secondary) py-0.5 pr-0.5 pl-2 text-xs text-(--ui-text-secondary)",
				children: [
					/* @__PURE__ */ jsx(Codicon, { name: "eye" }),
					/* @__PURE__ */ jsx("span", {
						className: "truncate",
						children: where
					}),
					/* @__PURE__ */ jsx(Button, {
						"aria-label": "Don’t include",
						onClick: shared.stop,
						size: "icon-xs",
						variant: "ghost",
						children: /* @__PURE__ */ jsx(Codicon, { name: "close" })
					})
				]
			})
		})
	});
}
/** Desktop's OS door (open a URL in the browser, write the clipboard), from the plugin's context. */
var os = null;
var setOs = (value) => {
	os = value;
};
/** What an app's frame may ask of Desktop, through Freya's runtime (workspace/talaria/runtime.tsx): the frame can't
*  open windows or reach the clipboard itself. Only http(s), mailto and tel addresses open. */
async function answer(ask) {
	if (ask.talaria === "open" && typeof ask.url === "string") {
		const url = URL.canParse(ask.url) ? new URL(ask.url) : null;
		return Boolean(url && [
			"http:",
			"https:",
			"mailto:",
			"tel:"
		].includes(url.protocol) && await os?.openExternal(url.href));
	}
	if (ask.talaria === "copy" && typeof ask.text === "string" && ask.text.length <= 1e5) return Boolean(await os?.writeClipboard(ask.text));
	return false;
}
/** A shortcut pressed in an app's frame (its runtime sends Cmd and Control chords, and lifting Control or Tab),
*  pressed again here on the frame's element: Desktop's own shortcuts (⌘K, ⌘N, ⌃Tab…) listen on its window, which
*  never hears keys inside the frame. Dispatched at the frame, it reaches the window as any keypress in the page
*  does, and as a key on something that isn't a text field. */
function replay(at, key) {
	if (key.type !== "keydown" && key.type !== "keyup" || typeof key.key !== "string" || typeof key.code !== "string") return;
	at.dispatchEvent(new KeyboardEvent(key.type, {
		key: key.key,
		code: key.code,
		metaKey: key.metaKey === true,
		ctrlKey: key.ctrlKey === true,
		altKey: key.altKey === true,
		shiftKey: key.shiftKey === true,
		repeat: key.repeat === true,
		bubbles: true,
		cancelable: true,
		composed: true
	}));
}
/** Chat about an app: a fresh chat in the main area, with the app docked beside it and shared, so Hermes can read
*  what it shows (app_snapshot), talk about it, and change the app when asked (the page note says where its code is). A chat started from this page would leave Apps, closing the app's frame and with it
*  what Hermes could see. */
function chatAbout(app) {
	const { newChat, openWorkspace } = host;
	if (!newChat || !openWorkspace) return host.notifyError(/* @__PURE__ */ new Error("Update Hermes Desktop to chat beside an app."));
	newChat(host.state.profile.get());
	openWorkspace(`freya-app-${app.name}`, {
		title: displayName(app),
		dock: {
			pane: "workspace",
			pos: "right"
		},
		minWidth: "24rem",
		render: () => /* @__PURE__ */ jsx(AppView, {
			app,
			docked: true
		})
	});
}
/** Change an app on the box (its icon, its color, its pin), showing the change at once in every list and the sidebar; a failure
*  says so and puts back what the box has. */
async function change(app, patch, call) {
	const key = appsQueryKey(host.state.profile.get());
	queryClient.setQueryData(key, (list) => list?.map((a) => a.name === app.name ? {
		...a,
		...patch(a, list)
	} : a));
	if ($open.get()?.name === app.name) $open.set({
		...app,
		...patch(app, queryClient.getQueryData(key) ?? [])
	});
	try {
		await call();
	} catch (error) {
		host.notifyError(error, `Couldn’t change ${displayName(app)}`);
	}
	queryClient.invalidateQueries({ queryKey: key });
}
/** The app as the list has it now: a pick made here or on another view shows up in an open app's header too. */
function useCurrent(app) {
	const profile = useValue(host.state.profile);
	const { data } = useQuery({
		queryKey: appsQueryKey(profile),
		queryFn: apps,
		enabled: false
	});
	return data?.find((a) => a.name === app.name) ?? app;
}
/** Pin to the sidebar, or unpin: the same on Desktop and the iPhone. */
function PinButton({ app }) {
	const pinned = app.pinned != null;
	const toggle = () => change(app, (_, list) => ({ pinned: pinned ? null : Math.max(-1, ...list.map((a) => a.pinned ?? -1)) + 1 }), () => setAppPinned(app.name, !pinned));
	return /* @__PURE__ */ jsx(Tip, {
		label: pinned ? "Unpin from the sidebar" : "Pin to the sidebar",
		children: /* @__PURE__ */ jsx(Button, {
			"aria-label": pinned ? "Unpin from the sidebar" : "Pin to the sidebar",
			onClick: () => void toggle(),
			size: "icon-xs",
			variant: "ghost",
			children: /* @__PURE__ */ jsx(Codicon, { name: pinned ? "pinned" : "pin" })
		})
	});
}
/** An app's mark: its own image when that's its icon (fully custom, so no color), else its codicon in its color. */
function AppMark({ app, size }) {
	const custom = app.icon === "image" && !!app.image;
	const { data } = useQuery({
		queryKey: [
			"freya",
			"app-image",
			app.name,
			app.image
		],
		queryFn: () => appImage(app.name),
		enabled: custom,
		staleTime: Infinity
	});
	if (custom && data) return /* @__PURE__ */ jsx("img", {
		alt: "",
		src: data,
		style: {
			width: size ?? "1rem",
			height: size ?? "1rem",
			borderRadius: "22%",
			display: "block"
		}
	});
	return /* @__PURE__ */ jsx("span", {
		style: { color: appTint(app) },
		children: /* @__PURE__ */ jsx(Codicon, {
			name: appCodicon(app),
			size
		})
	});
}
/** The app whose icon is being picked, and which view shows the modal: a view's own key (IconHost), so the Apps page
*  and an app docked beside a chat don't both open it. */
var $iconFor = atom(null);
var IconHost = createContext({});
/** The app's icon, in its color; click to pick another from the kit, in a modal (IconModal), as a project's icon is
*  picked. */
function IconPicker({ app }) {
	const host = useContext(IconHost);
	return /* @__PURE__ */ jsx(Tip, {
		label: "Change icon",
		children: /* @__PURE__ */ jsx(Button, {
			"aria-label": "Change icon",
			onClick: () => $iconFor.set({
				app,
				host
			}),
			size: "icon-xs",
			variant: "ghost",
			children: /* @__PURE__ */ jsx(AppMark, { app })
		})
	});
}
/** The modal's own styles: Desktop's Tailwind only has the classes Desktop itself uses, so a plugin's layout classes
*  (fixed, grid-cols-7, bg-black/40, …) may not exist there. */
var ICON_MODAL_CSS = `
.freya-icons { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
  background: rgb(0 0 0 / 0.35); }
.freya-icons-card { width: 22rem; max-width: calc(100vw - 2rem); padding: 1rem; border-radius: 0.75rem;
  border: 1px solid var(--ui-stroke-secondary, rgb(0 0 0 / 0.1)); background: var(--ui-bg-elevated, Canvas);
  color: inherit; box-shadow: 0 20px 50px rgb(0 0 0 / 0.25); }
.freya-icons-head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
.freya-icons-preview { display: flex; width: 2.25rem; height: 2.25rem; flex-shrink: 0; align-items: center;
  justify-content: center; border-radius: 0.5rem; background: var(--ui-control-hover-background, rgb(0 0 0 / 0.06)); }
.freya-icons-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem;
  color: var(--ui-text-secondary, GrayText); }
.freya-icons-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.25rem; max-height: 15rem;
  overflow-y: auto; }
.freya-icons-colors { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-bottom: 0.75rem; }
.freya-icons-swatch { display: flex; width: 1.375rem; height: 1.375rem; align-items: center; justify-content: center;
  border-radius: 999px; border: 2px solid transparent; padding: 0; cursor: pointer; background-clip: padding-box;
  color: var(--ui-text-secondary, GrayText); }
.freya-icons-swatch[aria-checked='true'] { box-shadow: 0 0 0 2px var(--ui-bg-elevated, Canvas), 0 0 0 4px currentColor; }
.freya-icons-tile { display: flex; height: 2.25rem; align-items: center; justify-content: center; border-radius: 0.5rem;
  border: 1.5px solid transparent; background: none; color: inherit; cursor: pointer; }
.freya-icons-tile:hover { background: var(--ui-control-hover-background, rgb(0 0 0 / 0.06)); }
.freya-icons-tile[aria-selected='true'] { border-color: var(--ui-accent, currentColor); color: var(--ui-accent, inherit);
  background: var(--ui-control-active-background, rgb(0 0 0 / 0.08)); }
.freya-icons-foot { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
`;
/** A view whose icon pickers open the modal over it. */
function WithIconModal({ children }) {
	const me = useRef({}).current;
	return /* @__PURE__ */ jsxs(IconHost.Provider, {
		value: me,
		children: [/* @__PURE__ */ jsx(IconModal, { host: me }), children]
	});
}
/** Pick an app's icon from the kit and its color, centered over the view, with Save, the same pick on every device.
*  Escape or a click outside cancels. Only what the box takes is offered: an older plugin knows fewer icons and keeps
*  no colors. */
function IconModal({ host: me }) {
	const asked = useValue($iconFor);
	const profile = useValue(host.state.profile);
	const [icon, setIcon] = useState(null);
	const [color, setColor] = useState(null);
	const app = asked?.host === me ? asked.app : null;
	useEffect(() => {
		if (!app) return;
		setIcon(app.icon ?? null);
		setColor(app.color ?? null);
		const esc = (e) => {
			if (e.key === "Escape") $iconFor.set(null);
		};
		addEventListener("keydown", esc);
		return () => removeEventListener("keydown", esc);
	}, [app?.name]);
	if (!app) return null;
	const kit = recall("app-kit", profile);
	const icons = kit?.icons ? APP_ICONS.filter((name) => kit.icons.includes(name)) : APP_ICONS;
	const colors = kit?.colors ? APP_COLORS.filter((name) => kit.colors?.includes(name)) : [];
	const save = () => {
		$iconFor.set(null);
		if (icon !== (app.icon ?? null)) change(app, () => ({ icon }), () => setAppIcon(app.name, icon ?? "none"));
		if (color !== (app.color ?? null)) change(app, () => ({ color }), () => setAppColor(app.name, color ?? "none"));
	};
	return /* @__PURE__ */ jsxs("div", {
		className: "freya-icons",
		onMouseDown: () => $iconFor.set(null),
		children: [/* @__PURE__ */ jsx("style", { children: ICON_MODAL_CSS }), /* @__PURE__ */ jsxs("div", {
			"aria-label": "App icon",
			"aria-modal": "true",
			className: "freya-icons-card",
			onMouseDown: (e) => e.stopPropagation(),
			role: "dialog",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "freya-icons-head",
					children: [/* @__PURE__ */ jsx("span", {
						className: "freya-icons-preview",
						children: /* @__PURE__ */ jsx(AppMark, {
							app: {
								...app,
								icon,
								color
							},
							size: "1.1rem"
						})
					}), /* @__PURE__ */ jsxs("div", {
						style: { minWidth: 0 },
						children: [/* @__PURE__ */ jsx("h2", {
							style: {
								fontSize: "0.875rem",
								fontWeight: 600
							},
							children: "App icon"
						}), /* @__PURE__ */ jsx("p", {
							className: "freya-icons-name",
							children: displayName(app)
						})]
					})]
				}),
				colors.length > 0 && /* @__PURE__ */ jsx("div", {
					"aria-label": "Color",
					className: "freya-icons-colors",
					role: "radiogroup",
					children: [null, ...colors].map((name) => /* @__PURE__ */ jsx("button", {
						"aria-checked": color === name,
						"aria-label": name ?? "No color",
						className: "freya-icons-swatch",
						onClick: () => setColor(name),
						role: "radio",
						title: name ?? "No color",
						type: "button",
						style: name ? {
							background: appTint({ color: name }),
							color: appTint({ color: name })
						} : void 0,
						children: !name && /* @__PURE__ */ jsx(Codicon, {
							name: "circle-slash",
							size: "0.9rem"
						})
					}, name ?? "none"))
				}),
				/* @__PURE__ */ jsx("div", {
					className: "freya-icons-grid",
					role: "listbox",
					children: [
						null,
						...app.image ? ["image"] : [],
						...icons
					].map((name) => /* @__PURE__ */ jsx("button", {
						"aria-label": name === "image" ? "Its own image" : name ?? "No icon",
						"aria-selected": icon === name,
						className: "freya-icons-tile",
						onClick: () => setIcon(name),
						onDoubleClick: save,
						role: "option",
						title: name === "image" ? "Its own image" : name ?? "No icon",
						type: "button",
						children: name === "image" ? /* @__PURE__ */ jsx(AppMark, {
							app: {
								...app,
								icon: "image"
							},
							size: "1.1rem"
						}) : /* @__PURE__ */ jsx("span", {
							style: { color: icon === name ? appTint({ color }) : void 0 },
							children: /* @__PURE__ */ jsx(Codicon, { name: name ?? "browser" })
						})
					}, name ?? "none"))
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "freya-icons-foot",
					children: [/* @__PURE__ */ jsx(Button, {
						onClick: () => $iconFor.set(null),
						size: "sm",
						variant: "ghost",
						children: "Cancel"
					}), /* @__PURE__ */ jsx(Button, {
						onClick: save,
						size: "sm",
						children: "Save"
					})]
				})
			]
		})]
	});
}
/** Every app Hermes has built on the box; click one to open it in place. */
function AppsPage() {
	const open = useValue($open);
	return open ? /* @__PURE__ */ jsx(AppView, { app: open }) : /* @__PURE__ */ jsx(AppList, {});
}
function AppList() {
	const profile = useValue(host.state.profile);
	const query = useQuery({
		queryKey: appsQueryKey(profile),
		queryFn: apps,
		refetchInterval: 6e4,
		initialData: () => recall("apps", profile),
		initialDataUpdatedAt: 0
	});
	const list = query.data ?? [];
	return /* @__PURE__ */ jsx(WithIconModal, { children: /* @__PURE__ */ jsx(Page, {
		count: list.length,
		onRefresh: () => void query.refetch(),
		refreshing: query.isFetching,
		title: "Apps",
		children: !query.data ? /* @__PURE__ */ jsx(Status, {
			error: query.error,
			feature: "Apps",
			loading: query.isPending
		}) : list.length ? /* @__PURE__ */ jsx(Section, {
			count: list.length,
			title: "Apps",
			children: list.map((app) => /* @__PURE__ */ jsx(Row, {
				actions: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(IconPicker, { app }), /* @__PURE__ */ jsx(PinButton, { app })] }),
				detail: app.name,
				lead: /* @__PURE__ */ jsx(AppMark, {
					app,
					size: "0.8rem"
				}),
				onClick: () => $open.set(app),
				title: displayName(app),
				trailing: ago(app.updated)
			}, app.name))
		}) : /* @__PURE__ */ jsx(EmptyState, {
			description: "Ask for one in any chat with /freya:app: a dashboard, a tracker, a planner.",
			title: "No apps yet"
		})
	}) });
}
/** An app pinned to the sidebar, on a page of its own: the Apps page's view of it, without the way back to the list. */
function PinnedApp({ name }) {
	const profile = useValue(host.state.profile);
	const { data, error, isPending } = useQuery({
		queryKey: appsQueryKey(profile),
		queryFn: apps,
		initialData: () => recall("apps", profile),
		initialDataUpdatedAt: 0
	});
	const app = data?.find((a) => a.name === name);
	if (app) return /* @__PURE__ */ jsx(AppView, {
		app,
		list: false
	});
	return data ? /* @__PURE__ */ jsx(EmptyState, {
		description: "It may have been removed or renamed.",
		title: "This app isn’t on the server"
	}) : /* @__PURE__ */ jsx(Status, {
		error,
		feature: "Apps",
		loading: isPending
	});
}
/** An app, full page, from the backend's loopback port: the workspace dev server (every app at /<app>/) or an older
*  app's own port. Forwarded over SSH, or through the gate on a direct connection (talaria.ts's appURL). */
/** An app open in place: on the Apps page, docked beside a chat about it (shared from the start), or pinned to the
*  sidebar (`list` false: no way back to the list). */
function AppView({ app: opened, docked = false, list = !docked }) {
	const app = useCurrent(opened);
	const profile = useValue(host.state.profile);
	const [reloads, setReloads] = useState(0);
	const [src, setSrc] = useState(null);
	const [shown, setShown] = useState(false);
	const frame = useRef(null);
	const [nav, setNav] = useState(null);
	const [sharing, setSharing] = useState(docked);
	const me = useRef({}).current;
	useEffect(() => {
		const listen = (e) => {
			if (!frame.current || e.source !== frame.current.contentWindow || typeof e.data?.talaria !== "string") return;
			if (e.data.talaria === "nav") {
				const { back, forward, page } = e.data;
				return setNav({
					back: Boolean(back),
					forward: Boolean(forward),
					page: typeof page === "string" ? page : ""
				});
			}
			if (e.data.talaria === "key") return replay(frame.current, e.data);
			answer(e.data).then((ok) => frame.current?.contentWindow?.postMessage({
				talaria: "answer",
				id: e.data.id,
				ok
			}, e.origin));
		};
		addEventListener("message", listen);
		return () => removeEventListener("message", listen);
	}, []);
	const greet = () => {
		setShown(true);
		if (src) frame.current?.contentWindow?.postMessage({
			talaria: "host",
			can: ["open", "copy"]
		}, new URL(src).origin);
		if (sharing) share(true);
	};
	const share = (on) => {
		setSharing(on);
		if (src) frame.current?.contentWindow?.postMessage({
			talaria: "share",
			on
		}, new URL(src).origin);
	};
	useEffect(() => {
		if (sharing) $shared.set({
			key: me,
			app,
			page: nav?.page ?? "",
			stop: () => share(false)
		});
		else if ($shared.get()?.key === me) $shared.set(null);
	}, [
		sharing,
		nav?.page,
		src
	]);
	useEffect(() => () => {
		if ($shared.get()?.key === me) $shared.set(null);
	}, []);
	const go = (way) => {
		if (src) frame.current?.contentWindow?.postMessage({ talaria: way }, new URL(src).origin);
	};
	const query = useQuery({
		queryKey: [
			"freya",
			profile,
			"open",
			app.name
		],
		queryFn: () => appURL(app.name),
		refetchInterval: 3e5,
		retry: 1,
		gcTime: 0
	});
	useEffect(() => {
		const at = query.data;
		if (!at) return;
		if (!src) setSrc(at.src);
		else if (at.ticketed && at.src !== src) fetch(at.src, {
			mode: "no-cors",
			cache: "no-store"
		}).catch(() => {});
	}, [query.data]);
	const reload = async () => {
		const fresh = await query.refetch();
		if (fresh.data) setSrc(fresh.data.src);
		setShown(false);
		setReloads((n) => n + 1);
	};
	return /* @__PURE__ */ jsx(WithIconModal, { children: /* @__PURE__ */ jsxs("main", {
		className: "flex h-full min-h-0 flex-col",
		children: [/* @__PURE__ */ jsxs("header", {
			className: "flex shrink-0 items-center gap-1 px-3 pt-3 pb-2",
			children: [
				list && /* @__PURE__ */ jsx(Tip, {
					label: "All apps",
					children: /* @__PURE__ */ jsx(Button, {
						"aria-label": "All apps",
						onClick: () => $open.set(null),
						size: "icon-xs",
						variant: "ghost",
						children: /* @__PURE__ */ jsx(Codicon, { name: "arrow-left" })
					})
				}),
				/* @__PURE__ */ jsx(IconPicker, { app }),
				/* @__PURE__ */ jsx("h1", {
					className: "truncate text-base font-semibold",
					children: displayName(app)
				}),
				/* @__PURE__ */ jsx("div", { className: "flex-1" }),
				nav && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(Tip, {
					label: "Back",
					children: /* @__PURE__ */ jsx(Button, {
						"aria-label": "Back",
						disabled: !nav.back,
						onClick: () => go("back"),
						size: "icon-xs",
						variant: "ghost",
						children: /* @__PURE__ */ jsx(Codicon, { name: "chevron-left" })
					})
				}), /* @__PURE__ */ jsx(Tip, {
					label: "Forward",
					children: /* @__PURE__ */ jsx(Button, {
						"aria-label": "Forward",
						disabled: !nav.forward,
						onClick: () => go("forward"),
						size: "icon-xs",
						variant: "ghost",
						children: /* @__PURE__ */ jsx(Codicon, { name: "chevron-right" })
					})
				})] }),
				nav && /* @__PURE__ */ jsx(Tip, {
					label: sharing ? "Hermes can see this page. Stop sharing" : "Let Hermes see this page",
					children: /* @__PURE__ */ jsx(Button, {
						"aria-label": sharing ? "Stop sharing this page with Hermes" : "Let Hermes see this page",
						className: sharing ? "text-(--ui-accent)" : void 0,
						onClick: () => share(!sharing),
						size: "icon-xs",
						variant: "ghost",
						children: /* @__PURE__ */ jsx(Codicon, { name: sharing ? "eye" : "eye-closed" })
					})
				}),
				nav && !docked && /* @__PURE__ */ jsx(Tip, {
					label: "Chat about this page",
					children: /* @__PURE__ */ jsx(Button, {
						"aria-label": "Chat about this page",
						onClick: () => chatAbout(app),
						size: "icon-xs",
						variant: "ghost",
						children: /* @__PURE__ */ jsx(Codicon, { name: "comment" })
					})
				}),
				/* @__PURE__ */ jsx(PinButton, { app }),
				/* @__PURE__ */ jsx(Tip, {
					label: "Reload",
					children: /* @__PURE__ */ jsx(Button, {
						"aria-label": "Reload",
						onClick: () => void reload(),
						size: "icon-xs",
						variant: "ghost",
						children: /* @__PURE__ */ jsx(Codicon, { name: "refresh" })
					})
				})
			]
		}), /* @__PURE__ */ jsxs("div", {
			className: "relative min-h-0 flex-1 border-t border-(--ui-stroke-secondary)",
			children: [src && /* @__PURE__ */ jsx("iframe", {
				className: `h-full w-full border-0 bg-transparent transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`,
				onLoad: greet,
				ref: frame,
				sandbox: "allow-scripts allow-same-origin allow-forms allow-downloads allow-modals",
				src,
				title: displayName(app)
			}, `${src}#${reloads}`), !shown && /* @__PURE__ */ jsx("div", {
				className: "absolute inset-0",
				children: /* @__PURE__ */ jsx(Status, {
					error: query.error,
					feature: "Opening apps",
					loading: !query.error
				})
			})]
		})]
	}) });
}
// src/pages/inbox.tsx
var inboxKey = (profile) => [
	"freya",
	profile,
	"inbox"
];
/** What a row says and how it's marked, by state (as the iPhone app's Overview reads them). */
function describe(row) {
	switch (row.state) {
		case "running": return {
			tone: "good",
			detail: "Working"
		};
		case "approval": return {
			tone: "warn",
			detail: `Approve: ${row.reason ?? "an action"}`
		};
		case "question": return {
			tone: "warn",
			detail: row.reason || "Hermes has a question"
		};
		case "needs_you": return {
			tone: "warn",
			detail: row.reason || "Reply to Hermes"
		};
		case "stale": return {
			tone: "bad",
			detail: "The turn ended unexpectedly"
		};
		case "done": return {
			tone: "muted",
			detail: "Finished"
		};
		default: return null;
	}
}
/** One row per routine: a cron job's runs collapse to its newest. */
function collapseRoutineRuns(rows) {
	const seen = /* @__PURE__ */ new Set();
	return rows.filter((row) => {
		if (row.source !== "cron") return true;
		const loop = (row.title ?? row.session_id).split(" · ")[0];
		if (seen.has(loop)) return false;
		seen.add(loop);
		return true;
	});
}
function InboxPage() {
	const profile = useValue(host.state.profile);
	const queryClient = useQueryClient();
	const key = inboxKey(profile);
	const query = useQuery({
		queryKey: key,
		queryFn: inbox,
		refetchInterval: 15e3,
		initialData: () => recall("inbox", profile),
		initialDataUpdatedAt: 0
	});
	const clear = useMutation({
		mutationFn: dismiss,
		onMutate: (row) => queryClient.setQueryData(key, (rows) => rows?.filter((r) => r.session_id !== row.session_id)),
		onError: (error) => host.notifyError(error, "Couldn’t clear it"),
		onSettled: () => queryClient.invalidateQueries({ queryKey: key })
	});
	const rows = collapseRoutineRuns([...query.data ?? []].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0)));
	const needsYou = rows.filter((r) => [
		"approval",
		"question",
		"needs_you",
		"stale"
	].includes(r.state));
	const working = rows.filter((r) => r.state === "running");
	const finished = rows.filter((r) => r.state === "done");
	const row = (r) => {
		const d = describe(r);
		if (!d) return null;
		return /* @__PURE__ */ jsx(Row, {
			actions: r.state !== "running" && /* @__PURE__ */ jsx(Tip, {
				label: "Clear",
				children: /* @__PURE__ */ jsx(Button, {
					"aria-label": "Clear",
					onClick: () => clear.mutate(r),
					size: "icon-xs",
					variant: "ghost",
					children: /* @__PURE__ */ jsx(Codicon, { name: "check" })
				})
			}),
			detail: d.detail,
			lead: /* @__PURE__ */ jsx(StatusDot, { tone: d.tone }),
			onClick: () => void host.openSession(r.session_id, {
				profile,
				intent: "in-place"
			}),
			title: r.title || "Untitled session",
			trailing: ago(r.updated)
		}, r.session_id);
	};
	return /* @__PURE__ */ jsx(Page, {
		count: needsYou.length,
		onRefresh: () => void query.refetch(),
		refreshing: query.isFetching,
		title: "Overview",
		children: !query.data ? /* @__PURE__ */ jsx(Status, {
			error: query.error,
			feature: "Overview",
			loading: query.isPending
		}) : rows.length ? /* @__PURE__ */ jsxs(Fragment, { children: [
			/* @__PURE__ */ jsx(Section, {
				count: needsYou.length,
				title: "Needs you",
				children: needsYou.map(row)
			}),
			/* @__PURE__ */ jsx(Section, {
				count: working.length,
				title: "Working",
				children: working.map(row)
			}),
			/* @__PURE__ */ jsx(Section, {
				count: finished.length,
				title: "Finished",
				children: finished.map(row)
			})
		] }) : /* @__PURE__ */ jsx(EmptyState, { title: "Nothing running or waiting on you" })
	});
}
// src/plugin.tsx
/**
* Freya for Hermes Desktop: the iPhone app's Overview and Apps as pages in Hermes Desktop, each with a sidebar row
* and a command palette entry. Chat, files, review, scheduled jobs and the rest stay Hermes Desktop's own.
*
* Built by Vite into one ESM file (dist/talaria/plugin.js) that Desktop loads from
* `$HERMES_HOME/desktop-plugins/freya/`. Data comes from the gateway's JSON-RPC, so it follows the active
* profile, local or remote; Overview and Apps also need the Freya server plugin on that Hermes.
*/
var pages = [{
	id: "inbox",
	label: "Overview",
	codicon: "dashboard",
	page: () => /* @__PURE__ */ jsx(InboxPage, {})
}, {
	id: "apps",
	label: "Apps",
	codicon: "browser",
	page: () => /* @__PURE__ */ jsx(AppsPage, {})
}];
var plugin = {
	id: "freya",
	name: "Freya",
	description: "Overview and Apps from the Freya iPhone app, as pages in the sidebar.",
	register(ctx) {
		setOs(ctx.os);
		ctx.registerMany(pages.flatMap(({ id, label, codicon, page }) => {
			const path = `/freya/${id}`;
			return [
				{
					id: `${id}-page`,
					area: ROUTES_AREA,
					data: { path },
					render: page
				},
				{
					id: `${id}-nav`,
					area: SIDEBAR_NAV_AREA,
					data: {
						path,
						label,
						codicon
					}
				},
				{
					id: `${id}-open`,
					area: PALETTE_AREA,
					data: {
						id: `freya.${id}`,
						label: `Freya: ${label}`,
						keywords: [
							"freya",
							"talaria",
							id
						],
						run: () => host.navigate(path)
					}
				}
			];
		}));
		ctx.register({
			id: "nav-prefs",
			area: SIDEBAR_NAV_PREFS_AREA,
			data: { order: ["freya:inbox-nav"] }
		});
		ctx.register({
			id: "shared-page",
			area: COMPOSER_AREAS.top,
			render: () => /* @__PURE__ */ jsx(SharedChip, {})
		});
		const profile = host.state.profile.get();
		queryClient.prefetchQuery({
			queryKey: inboxKey(profile),
			queryFn: inbox
		}).then(() => queryClient.prefetchQuery({
			queryKey: appsQueryKey(profile),
			queryFn: apps
		}));
		retireTalaria();
		ctx.onDispose(pinApps(ctx));
		for (const event of [
			"message.complete",
			"approval.pending",
			"approval.received"
		]) ctx.onDispose(host.onEvent(event, () => void queryClient.invalidateQueries({ queryKey: inboxKey(host.state.profile.get()) })));
	}
};
/** A sidebar row and a page for each pinned app (in pin order), redone whenever the active profile's app list
*  changes: a pin, an icon or a title picked here or on the iPhone. The list is asked again every few minutes, so a
*  pin made on the phone shows up without visiting Apps. */
function pinApps(ctx) {
	let shown = "";
	let dispose = () => {};
	const sync = () => {
		const profile = host.state.profile.get();
		const rows = (queryClient.getQueryData(appsQueryKey(profile)) ?? recall("apps", profile) ?? []).filter((a) => a.pinned != null).sort((a, b) => a.pinned - b.pinned).map((a) => ({
			name: a.name,
			label: displayName(a),
			codicon: appCodicon(a)
		}));
		if (JSON.stringify(rows) === shown) return;
		shown = JSON.stringify(rows);
		dispose();
		dispose = ctx.registerMany(rows.flatMap(({ name, label, codicon }) => {
			const path = `/freya/app-${encodeURIComponent(name)}`;
			return [{
				id: `app-${name}-page`,
				area: ROUTES_AREA,
				data: { path },
				render: () => /* @__PURE__ */ jsx(PinnedApp, { name })
			}, {
				id: `app-${name}-nav`,
				area: SIDEBAR_NAV_AREA,
				data: {
					path,
					label,
					codicon
				}
			}];
		}));
	};
	const refresh = () => void queryClient.fetchQuery({
		queryKey: appsQueryKey(host.state.profile.get()),
		queryFn: apps,
		staleTime: 6e4
	}).catch(() => {});
	const unwatch = queryClient.getQueryCache().subscribe((event) => {
		if (event.type === "updated" && event.query.queryKey[2] === "apps") sync();
	});
	const unprofile = host.state.profile.listen(() => {
		sync();
		refresh();
	});
	const timer = setInterval(refresh, 3e5);
	sync();
	return () => {
		unwatch();
		unprofile();
		clearInterval(timer);
		dispose();
	};
}
export { plugin as default };
