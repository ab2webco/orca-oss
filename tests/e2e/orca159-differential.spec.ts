import { test } from "./helpers/orca-app";
import { waitForActiveWorktree, waitForSessionReady } from "./helpers/store";
import type { Page } from "@stablyai/playwright-test";

const MARQUEE_WORKSPACE_COUNT = 102;

async function seedAndOpenBoard(orcaPage: Page): Promise<void> {
  await waitForSessionReady(orcaPage);
  await waitForActiveWorktree(orcaPage);
  await orcaPage.evaluate(
    ({ count, status }) => {
      const store = window.__store;
      if (!store) {
        throw new Error("window.__store is not available");
      }
      const state = store.getState();
      const repo = state.repos[0];
      if (!repo) {
        throw new Error("Expected a seeded e2e repo");
      }
      const now = Date.now();
      const seeded = state.worktreesByRepo[repo.id] ?? [];
      const synthetic = Array.from({ length: count }, (_, index) => ({
        id: `${repo.id}::/virtual-marquee-${index}`,
        instanceId: `virtual-marquee-${index}`,
        repoId: repo.id,
        path: `${repo.path}/../virtual-marquee-${index}`,
        displayName: `Virtual marquee ${index}`,
        comment: "",
        linkedIssue: null,
        linkedPR: null,
        linkedLinearIssue: null,
        isArchived: false,
        isUnread: false,
        isPinned: false,
        sortOrder: 10_000 - index,
        manualOrder: 10_000 - index,
        lastActivityAt: now - index - 100,
        head: "0000000000000000000000000000000000000000",
        branch: `virtual-marquee-${index}`,
        isBare: false,
        isMainWorktree: false,
        workspaceStatus: status,
      }));
      state.setSidebarOpen(true);
      state.setShowSleepingWorkspaces(true);
      state.setFilterRepoIds([]);
      store.setState({
        sortBy: "manual",
        worktreesByRepo: {
          ...state.worktreesByRepo,
          [repo.id]: [...seeded, ...synthetic],
        },
      });
      state.setWorkspaceStatuses([
        { id: status, label: "Virtual marquee" },
        ...state.workspaceStatuses.filter((entry) => entry.id !== status),
      ]);
    },
    { count: MARQUEE_WORKSPACE_COUNT, status: "virtual-marquee" },
  );
  await orcaPage.getByRole("button", { name: "Workspace board" }).click();
  await orcaPage.waitForSelector("[data-workspace-board-card-id]");
}

async function holdSheetReveal(
  orcaPage: Page,
  resumeAfterMs: number,
): Promise<void> {
  await orcaPage.evaluate((resumeAfter) => {
    const sheet = document.querySelector('[data-slot="sheet-content"]');
    const animations = sheet?.getAnimations() ?? [];
    for (const animation of animations) {
      animation.currentTime = 0;
      animation.pause();
    }
    window.setTimeout(() => {
      for (const animation of animations) {
        animation.play();
      }
    }, resumeAfter);
  }, resumeAfterMs);
}

async function dragAndCount(
  orcaPage: Page,
  waitForReveal: boolean,
): Promise<number> {
  if (waitForReveal) {
    await orcaPage.evaluate(async () => {
      const sheet = document.querySelector('[data-slot="sheet-content"]');
      await Promise.all(
        (sheet?.getAnimations() ?? []).map((animation) => animation.finished),
      );
    });
  }
  const lane = orcaPage.locator('[data-workspace-status="virtual-marquee"]');
  const box = await lane
    .locator("[data-workspace-board-lane-scroll]")
    .boundingBox();
  const selectionBox = await orcaPage
    .locator("[data-workspace-board-selection-surface]")
    .boundingBox();
  if (!box || !selectionBox) {
    throw new Error("Expected boxes");
  }
  const anchorHit = await orcaPage.evaluate(
    ({ ax, ay }) => {
      const surface = document.querySelector(
        "[data-workspace-board-selection-surface]",
      );
      const hit = document.elementFromPoint(ax, ay);
      return {
        inSurface: Boolean(surface?.contains(hit)),
        clipPath: getComputedStyle(
          document.querySelector('[data-slot="sheet-content"]') as HTMLElement,
        ).clipPath,
      };
    },
    { ax: selectionBox.x + 4, ay: box.y + 12 },
  );
  console.log(`[ORCA159-DIFF] anchorHit=${JSON.stringify(anchorHit)}`);
  await orcaPage.mouse.move(selectionBox.x + 4, box.y + 12);
  await orcaPage.mouse.down();
  await orcaPage.mouse.move(box.x + box.width - 18, box.y + 80, { steps: 4 });
  const selected = await orcaPage.evaluate(
    () =>
      document.querySelectorAll(
        '[data-workspace-board-card-area-selected="true"]',
      ).length,
  );
  const selection = await orcaPage.evaluate(() =>
    String(document.getSelection()).slice(0, 60),
  );
  console.log(
    `[ORCA159-DIFF] waitForReveal=${waitForReveal} selected=${selected} textSelection="${selection}"`,
  );
  await orcaPage.mouse.up();
  return selected;
}

test.describe("ORCA-159 differential", () => {
  test("current test path: press during the sheet reveal", async ({
    orcaPage,
  }) => {
    await seedAndOpenBoard(orcaPage);
    await holdSheetReveal(orcaPage, 4000);
    const selected = await dragAndCount(orcaPage, false);
    console.log(`[ORCA159-DIFF] before-fix selected=${selected}`);
  });

  test("fixed test path: await the sheet reveal, then press", async ({
    orcaPage,
  }) => {
    await seedAndOpenBoard(orcaPage);
    await holdSheetReveal(orcaPage, 4000);
    const selected = await dragAndCount(orcaPage, true);
    console.log(`[ORCA159-DIFF] after-fix selected=${selected}`);
  });
});
