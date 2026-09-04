// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  extractCurrentThreadPost,
  extractThreadPost,
  fillComposer,
  getComposerAvailability,
  normalizeThreadsUrl,
  openComposerSurface,
} from "./index.js";

describe("Threads semantic adapter", () => {
  it("extracts one closest article with author and canonical URL", () => {
    document.body.innerHTML = `
      <article id="first">
        <a href="/@writer">writer</a>
        <div dir="auto">첫 문장입니다.</div>
        <div dir="auto">둘째 문장입니다.</div>
        <a href="/@writer/post/ABC?x=1">1시간</a>
        <button><span>좋아요</span></button>
      </article>
      <article><div dir="auto">다른 게시물</div></article>`;
    const target = document.querySelector("#first div")!;
    const result = extractThreadPost(target, {
      pageUrl: "https://www.threads.com/@writer/post/ABC?x=1",
      capturedAt: "2026-09-04T00:00:00.000Z",
    });
    expect(result).toMatchObject({
      text: "첫 문장입니다.\n둘째 문장입니다.",
      author: "writer",
      url: "https://www.threads.com/@writer/post/ABC",
      captureMethod: "article",
    });
  });

  it("fails safely when no article exists", () => {
    document.body.innerHTML = '<div id="target">text</div>';
    expect(
      extractThreadPost(document.querySelector("#target")!, {
        pageUrl: "https://www.threads.com/",
      }),
    ).toBeNull();
  });

  it("captures the permalink article without requiring a prior context menu click", () => {
    document.body.innerHTML = `
      <article><div dir="auto">피드의 다른 글</div><a href="/@other/post/OTHER">링크</a></article>
      <article id="current"><a href="/@writer">writer</a><div dir="auto">현재 게시물</div><a href="/@writer/post/CURRENT?x=1">링크</a></article>`;
    const result = extractCurrentThreadPost(document, {
      pageUrl: "https://www.threads.com/@writer/post/CURRENT",
      capturedAt: "2026-09-04T00:00:00.000Z",
    });
    expect(result).toMatchObject({
      text: "현재 게시물",
      url: "https://www.threads.com/@writer/post/CURRENT",
    });
  });

  it("rejects non-Threads URLs", () => {
    expect(normalizeThreadsUrl("https://evil.example/post/1")).toBeNull();
  });

  it("fills a composer but never finds or clicks a publish button", () => {
    document.body.innerHTML =
      '<div role="textbox" contenteditable="true"></div><button id="publish">게시</button>';
    const publish = document.querySelector<HTMLButtonElement>("#publish")!;
    let clicked = false;
    publish.addEventListener("click", () => (clicked = true));
    const result = fillComposer(document, "줄1\n줄2 😀");
    expect(result.ok).toBe(true);
    expect(document.querySelector('[role="textbox"]')?.textContent).toBe(
      "줄1\n줄2 😀",
    );
    expect(clicked).toBe(false);
  });

  it("ignores search and reply textboxes when a new-post composer exists", () => {
    document.body.innerHTML = `
      <div role="search"><div role="textbox" contenteditable="true" aria-label="검색"></div></div>
      <article><div role="textbox" contenteditable="true" aria-label="답글"></div></article>
      <div role="dialog"><div id="composer" role="textbox" contenteditable="true" aria-label="새 스레드"></div></div>`;
    expect(fillComposer(document, "새 글").ok).toBe(true);
    expect(document.querySelector("#composer")?.textContent).toBe("새 글");
    expect(document.querySelector('[aria-label="검색"]')?.textContent).toBe("");
  });

  it("opens only a composer trigger and never clicks the publish control", () => {
    document.body.innerHTML =
      '<button id="start">스레드 시작하기</button><button id="publish">게시</button>';
    let started = false;
    let published = false;
    document.querySelector("#start")?.addEventListener("click", () => {
      started = true;
    });
    document.querySelector("#publish")?.addEventListener("click", () => {
      published = true;
    });
    expect(openComposerSurface(document)).toBe(true);
    expect(started).toBe(true);
    expect(published).toBe(false);
  });

  it("distinguishes a logged-out page from an available composer", () => {
    document.body.innerHTML = '<a href="/login">로그인</a>';
    expect(
      getComposerAvailability(document, "https://www.threads.com/login"),
    ).toBe("login-required");
    document.body.innerHTML =
      '<div role="textbox" contenteditable="true"></div>';
    expect(getComposerAvailability(document, "https://www.threads.com/")).toBe(
      "ready",
    );
  });
});
