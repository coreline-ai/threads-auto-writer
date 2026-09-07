/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli consumes this function expression */
/* global window, document, innerWidth, getComputedStyle, requestAnimationFrame */
// Run with playwright-cli run-code --filename from the repository root.
// Precondition: an isolated test profile showing a completed draft on the writing screen.
// prettier-ignore
async (page) => {
  const originalSize = page.viewportSize();
  const mode = await page
    .getByRole("combobox", { name: "상단 화면 테마" })
    .inputValue();
  const panel = page.locator(".revision-panel");
  const summary = page.locator(".revision-panel > summary");
  const originallyOpen = await panel.evaluate((e) => e.open);
  const report = [];
  try {
    if (originallyOpen) await summary.click();
    for (const theme of ["dark", "light"]) {
      await page
        .getByRole("combobox", { name: "상단 화면 테마" })
        .selectOption(theme);
      for (const width of [1440, 1024, 390, 340]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const size = await page.evaluate(() => ({
          width: innerWidth,
          document: document.documentElement.scrollWidth,
          actions: document.querySelectorAll(".editor-actions").length,
        }));
        if (size.document > width || size.actions !== 1)
          throw new Error("Overflow or duplicate action bar");
        await summary.click();
        if (
          (await page
            .locator(".editor-actions")
            .evaluate((e) => getComputedStyle(e).position)) !== "static"
        )
          throw new Error("Expanded revision obscured");
        await page
          .getByRole("textbox", { name: "수정 요청", exact: true })
          .focus();
        await page.keyboard.press("Tab");
        const visible = await page.evaluate(() => {
          const rect = document.activeElement.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight;
        });
        if (!visible) throw new Error("Keyboard focus hidden");
        await summary.click();
        report.push({ theme, ...size, expandedAndKeyboard: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await summary.click(); // Pointer hit-testing must succeed, not merely DOM visibility.
    const zoom = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      position: getComputedStyle(document.querySelector(".editor-actions"))
        .position,
    }));
    if (zoom.overflow || zoom.position !== "static")
      throw new Error("Zoomed action bar overlap");
    return { report, cssZoom200: zoom, nativeBrowserZoom: false };
  } finally {
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
    if (originalSize) await page.setViewportSize(originalSize);
    if ((await panel.evaluate((e) => e.open)) !== originallyOpen)
      await summary.click();
    await page
      .getByRole("combobox", { name: "상단 화면 테마" })
      .selectOption(mode);
  }
}
