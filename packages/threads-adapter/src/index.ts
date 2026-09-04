import type { SourceSnapshot } from "@threadflow-os/contracts";

export const THREADS_ADAPTER_VERSION = "threads-web-v1";

export type ExtractedThreadPost = Omit<SourceSnapshot, "id">;

const UI_LABELS = new Set([
  "좋아요",
  "답글",
  "리포스트",
  "공유",
  "like",
  "reply",
  "repost",
  "share",
  "more",
  "더 보기",
]);

export function normalizeThreadsUrl(
  raw: string,
  base = "https://www.threads.com/",
): string | null {
  try {
    const url = new URL(raw, base);
    if (!/(^|\.)threads\.(com|net)$/i.test(url.hostname)) return null;
    url.protocol = "https:";
    url.hostname = "www.threads.com";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function extractThreadPost(
  target: Element,
  options: { pageUrl: string; capturedAt?: string },
): ExtractedThreadPost | null {
  const article = target.closest("article");
  if (!article) return null;
  const authorAnchor = [
    ...article.querySelectorAll<HTMLAnchorElement>('a[href^="/@"]'),
  ].find((anchor) => /^\/@[^/]+\/?$/.test(anchor.getAttribute("href") ?? ""));
  const postAnchor = [
    ...article.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]'),
  ].find((anchor) =>
    Boolean(
      normalizeThreadsUrl(anchor.getAttribute("href") ?? "", options.pageUrl),
    ),
  );
  const text = extractArticleText(article, authorAnchor?.textContent ?? null);
  if (!text) return null;
  return {
    text,
    author:
      authorAnchor?.textContent?.trim() ||
      authorFromHref(authorAnchor?.getAttribute("href")),
    url: normalizeThreadsUrl(
      postAnchor?.getAttribute("href") ?? options.pageUrl,
      options.pageUrl,
    ),
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    captureMethod: "article",
    adapterVersion: THREADS_ADAPTER_VERSION,
  };
}

export function extractCurrentThreadPost(
  root: ParentNode,
  options: {
    pageUrl: string;
    preferredTarget?: Element | null;
    capturedAt?: string;
  },
): ExtractedThreadPost | null {
  const target = findThreadPostTarget(
    root,
    options.pageUrl,
    options.preferredTarget,
  );
  return target
    ? extractThreadPost(target, {
        pageUrl: options.pageUrl,
        ...(options.capturedAt ? { capturedAt: options.capturedAt } : {}),
      })
    : null;
}

export function findThreadPostTarget(
  root: ParentNode,
  pageUrl: string,
  preferredTarget?: Element | null,
): Element | null {
  const preferredArticle = preferredTarget?.closest("article");
  if (preferredArticle) return preferredArticle;

  const activeElement =
    root instanceof Document ? root.activeElement?.closest("article") : null;
  if (activeElement) return activeElement;

  const articles = [...root.querySelectorAll<HTMLElement>("article")].filter(
    (article) => Boolean(extractArticleText(article, null)),
  );
  if (!articles.length) return null;

  const normalizedPage = normalizeThreadsUrl(pageUrl);
  if (normalizedPage && /\/post\//.test(new URL(normalizedPage).pathname)) {
    const permalinkArticle = articles.find((article) =>
      [
        ...article.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]'),
      ].some(
        (anchor) =>
          normalizeThreadsUrl(anchor.getAttribute("href") ?? "", pageUrl) ===
          normalizedPage,
      ),
    );
    if (permalinkArticle) return permalinkArticle;
  }

  const visible = articles
    .map((article) => ({
      article,
      distance: distanceFromViewportCenter(article),
    }))
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((left, right) => left.distance - right.distance);
  return visible[0]?.article ?? articles[0] ?? null;
}

export function extractSelection(
  selection: Selection | null,
  pageUrl: string,
  capturedAt = new Date().toISOString(),
): ExtractedThreadPost | null {
  const text = selection?.toString().trim() ?? "";
  if (!text) return null;
  return {
    text,
    author: null,
    url: normalizeThreadsUrl(pageUrl),
    capturedAt,
    captureMethod: "selection",
    adapterVersion: THREADS_ADAPTER_VERSION,
  };
}

export function findComposer(root: ParentNode = document): HTMLElement | null {
  const selectors = [
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    "textarea[aria-label]",
    "textarea",
  ];
  const candidates = selectors.flatMap((selector) => [
    ...root.querySelectorAll<HTMLElement>(selector),
  ]);
  const unique = [...new Set(candidates)].filter(isVisible);
  const ranked = unique
    .map((element, order) => ({
      element,
      order,
      score: composerScore(element),
    }))
    .filter((entry) => entry.score > -500)
    .sort(
      (left, right) => right.score - left.score || left.order - right.order,
    );
  return ranked[0]?.element ?? null;
}

export function openComposerSurface(root: ParentNode = document): boolean {
  const controls = [
    ...root.querySelectorAll<HTMLElement>('button, [role="button"], a'),
  ];
  const trigger = controls.find((element) => {
    if (
      !isVisible(element) ||
      element.getAttribute("aria-disabled") === "true" ||
      (element instanceof HTMLButtonElement && element.disabled)
    )
      return false;
    const label =
      `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`
        .replace(/\s+/g, " ")
        .trim();
    return /(?:스레드 시작|새 스레드|새로운 스레드|새로운 소식|start a thread|new thread|create thread)/i.test(
      label,
    );
  });
  if (!trigger) return false;
  trigger.click();
  return true;
}

export function getComposerAvailability(
  root: ParentNode,
  pageUrl: string,
): "ready" | "login-required" | "unavailable" {
  if (findComposer(root)) return "ready";
  try {
    if (/^\/login(?:\/|$)/.test(new URL(pageUrl).pathname))
      return "login-required";
  } catch {
    return "unavailable";
  }
  const loginControl = [
    ...root.querySelectorAll<HTMLElement>('a[href*="/login"], button'),
  ].some((element) =>
    /^(로그인|log in|sign in|instagram으로 로그인)$/i.test(
      element.textContent?.trim() ?? "",
    ),
  );
  return loginControl ? "login-required" : "unavailable";
}

export function fillComposer(
  root: ParentNode,
  text: string,
): { ok: boolean; method: "contenteditable" | "textarea" | "none" } {
  const composer = findComposer(root);
  if (!composer) return { ok: false, method: "none" };
  composer.focus();
  if (composer instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(composer, text);
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true, method: "textarea" };
  }
  composer.textContent = text;
  composer.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    }),
  );
  return { ok: true, method: "contenteditable" };
}

export function threadsComposeUrl(): string {
  return "https://www.threads.com/";
}

function extractArticleText(article: Element, author: string | null): string {
  const preferred = [...article.querySelectorAll<HTMLElement>('[dir="auto"]')]
    .map((node) => node.innerText || node.textContent || "")
    .map(cleanLine)
    .filter((line) => line && !isUiLabel(line) && line !== author);
  const source = preferred.length ? preferred : [article.textContent ?? ""];
  const lines: string[] = [];
  for (const block of source) {
    for (const line of block.split("\n").map(cleanLine)) {
      if (line && !isUiLabel(line) && line !== author && lines.at(-1) !== line)
        lines.push(line);
    }
  }
  return lines.join("\n").trim();
}

function cleanLine(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function isUiLabel(value: string): boolean {
  return (
    UI_LABELS.has(value.toLocaleLowerCase("ko-KR")) ||
    /^\d+[분시간일주]$/.test(value)
  );
}

function authorFromHref(href?: string | null): string | null {
  const match = href?.match(/^\/@([^/]+)/);
  return match?.[1] ? `@${match[1]}` : null;
}

function isVisible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true")
    return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display !== "none" && style?.visibility !== "hidden";
}

function composerScore(element: HTMLElement): number {
  const label =
    `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("placeholder") ?? ""}`.trim();
  if (
    element.closest('[role="search"]') ||
    /(?:검색|search)/i.test(label) ||
    /(?:답글|reply)/i.test(label)
  )
    return -1_000;
  let score = 0;
  if (element.closest('[role="dialog"], [aria-modal="true"]')) score += 100;
  if (/(?:스레드|thread|게시물|post|무슨 생각|새로운 소식)/i.test(label))
    score += 50;
  if (!element.closest("article")) score += 20;
  if (element.getAttribute("data-lexical-editor") === "true") score += 10;
  return score;
}

function distanceFromViewportCenter(element: HTMLElement): number {
  if (!isVisible(element)) return Number.POSITIVE_INFINITY;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return Number.POSITIVE_INFINITY;
  const viewportHeight = element.ownerDocument.defaultView?.innerHeight ?? 0;
  const center = rect.top + rect.height / 2;
  return Math.abs(center - viewportHeight / 2);
}
