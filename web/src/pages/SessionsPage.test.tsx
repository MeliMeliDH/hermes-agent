// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getSessions: vi.fn(),
  getSessionMessages: vi.fn(),
  getEmptySessionsCount: vi.fn(),
  getStatus: vi.fn(),
  searchSessions: vi.fn(),
  importSessions: vi.fn(),
  exportSessionUrl: vi.fn(),
  renameSession: vi.fn(),
  pruneSessions: vi.fn(),
  deleteSession: vi.fn(),
  deleteEmptySessions: vi.fn(),
  bulkDeleteSessions: vi.fn(),
  getProfiles: vi.fn(),
  getActiveProfile: vi.fn(),
  getSessionStats: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMocks,
  // ProfileProvider mirrors its selection into the api module.
  setManagementProfile: vi.fn(),
  getManagementProfile: vi.fn(() => ""),
}));
vi.mock("@/components/PlatformsCard", () => ({ PlatformsCard: () => null }));
vi.mock("@/components/Markdown", () => ({ Markdown: () => null }));

let container: HTMLDivElement;
let root: Root;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function waitFor(cond: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: condition never became true");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

function click(el: Element | null) {
  if (!el) throw new Error("element not rendered");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

const button = (label: string) => document.querySelector(`button[aria-label="${label}"]`);

interface SessionsResponse {
  sessions: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function sessionsResponse(sessions: Record<string, unknown>[]): SessionsResponse {
  return { sessions, total: sessions.length, limit: 1, offset: 0 };
}

interface SessionsPageFixture {
  pageTwo?: Record<string, unknown>[];
  recent?: Record<string, unknown>[];
  recentLookup?: (scope: object) => Promise<SessionsResponse>;
  search?: Record<string, unknown>[];
  total?: number;
}

async function renderSessionsPage(
  rows: Record<string, unknown>[],
  fixture: SessionsPageFixture = {},
) {
  // Page list uses limit 20; the overview tab's recent-cards fetch uses 50 —
  // keep the overview empty so the list view (with row actions) renders.
  apiMocks.getSessions.mockImplementation(
    async (limit: number, offset: number, options: object, order?: string) => {
      if (order === "recent" && fixture.recentLookup) {
        return fixture.recentLookup(options);
      }
      const sessions =
        order === "recent"
          ? (fixture.recent ?? rows.slice(0, 1))
          : limit >= 50
            ? []
            : offset >= 20
              ? (fixture.pageTwo ?? [])
              : rows;
      return {
        sessions,
        total: limit >= 50 ? 0 : (fixture.total ?? rows.length),
        limit,
        offset,
      };
    },
  );
  apiMocks.searchSessions.mockResolvedValue({ results: fixture.search ?? [] });
  const [{ default: SessionsPage }, { I18nProvider }, { SystemActionsProvider }, { ProfileProvider }, { PageHeaderProvider }] =
    await Promise.all([
      import("./SessionsPage"),
      import("@/i18n"),
      import("@/contexts/SystemActions"),
      import("@/contexts/ProfileProvider"),
      import("@/contexts/PageHeaderProvider"),
    ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <I18nProvider>
        <MemoryRouter>
          <SystemActionsProvider>
            <ProfileProvider>
              <PageHeaderProvider pluginTabs={[]}>
                <SessionsPage />
              </PageHeaderProvider>
            </ProfileProvider>
          </SystemActionsProvider>
        </MemoryRouter>
      </I18nProvider>,
    ),
  );
  await waitFor(() => Boolean(button("Delete session")));
}

beforeEach(() => {
  for (const fn of Object.values(apiMocks)) fn.mockReset();
  apiMocks.getStatus.mockResolvedValue({});
  apiMocks.getEmptySessionsCount.mockResolvedValue({ count: 0 });
  apiMocks.getProfiles.mockResolvedValue({ profiles: [] });
  // active === current keeps the management profile "" — the precondition
  // under which an unstamped request hits the process's own store.
  apiMocks.getActiveProfile.mockResolvedValue({ current: "default", active: "default" });
  apiMocks.getSessionStats.mockResolvedValue({ by_source: {} });
  apiMocks.getSessionMessages.mockResolvedValue({ messages: [] });
  apiMocks.deleteSession.mockResolvedValue({ ok: true });
  apiMocks.renameSession.mockResolvedValue({ ok: true, title: "Renamed" });
  apiMocks.exportSessionUrl.mockReturnValue("/api/sessions/x/export");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
  vi.stubGlobal("ResizeObserver", class { disconnect() {} observe() {} unobserve() {} });
  // gsap ticks through rAF; a synchronous callback recurses to death.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.stubGlobal("matchMedia", () => ({ addEventListener() {}, matches: false, media: "", removeEventListener() {} }));
  sessionStorage.clear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SessionsPage most recent session", () => {
  it("uses the globally recent result and keeps the Live badge", async () => {
    const globalRecent = {
      id: "global-recent", profile: "default", source: "cli", model: null, title: "Global recent", started_at: 1,
      ended_at: null, last_active: 10, is_active: true, message_count: 3, tool_call_count: 0, input_tokens: 1,
      output_tokens: 1, preview: "new",
    };
    const pageLocalMax = {
      id: "page-local-max", profile: "default", source: "cli", model: null, title: "Page local max", started_at: 2,
      ended_at: null, last_active: 999, is_active: false, message_count: 2, tool_call_count: 0, input_tokens: 1,
      output_tokens: 1, preview: "old",
    };
    await renderSessionsPage([pageLocalMax, globalRecent], { recent: [globalRecent] });

    await waitFor(() => document.body.textContent?.includes("Most recent") ?? false);
    const pageCall = apiMocks.getSessions.mock.calls.find(
      ([limit, , , order]) => limit === 20 && order === undefined,
    );
    const recentCall = apiMocks.getSessions.mock.calls.find(
      ([limit, , , order]) => limit === 1 && order === "recent",
    );
    expect(recentCall).toBeDefined();
    expect(recentCall?.[2]).toBe(pageCall?.[2]);
    expect(document.body.textContent?.match(/Most recent/g)).toHaveLength(1);
    const globalRow = Array.from(document.querySelectorAll("div.cursor-pointer")).find(
      (row) => row.textContent?.includes("Global recent"),
    );
    const localRow = Array.from(document.querySelectorAll("div.cursor-pointer")).find(
      (row) => row.textContent?.includes("Page local max"),
    );
    expect(globalRow?.textContent).toContain("Most recent");
    expect(globalRow?.textContent).toContain("Live");
    expect(localRow?.textContent).not.toContain("Most recent");
  });

  it("orders polling results, isolates scopes, and clears only current failures", async () => {
    const staleSameScope = {
      id: "stale-same-scope", profile: "default", source: "cli", model: null, title: "Stale same scope", started_at: 1,
      ended_at: null, last_active: 10, is_active: false, message_count: 2, tool_call_count: 0, input_tokens: 1,
      output_tokens: 1, preview: "stale",
    };
    const newerSameScope = {
      id: "newer-same-scope", profile: "default", source: "cli", model: null, title: "Newer same scope", started_at: 2,
      ended_at: null, last_active: 20, is_active: false, message_count: 2, tool_call_count: 0, input_tokens: 1,
      output_tokens: 1, preview: "newer",
    };
    const currentScope = {
      id: "current-scope", session_id: "current-scope", profile: "default", source: "cron", model: null,
      title: "Current scope", started_at: 3, ended_at: null, last_active: 30, is_active: false, message_count: 3,
      tool_call_count: 0, input_tokens: 1, output_tokens: 1, preview: "needle", snippet: "needle",
    };
    const pageTwo = {
      id: "page-two-local-max", profile: "default", source: "cron", model: null, title: "Page two local max", started_at: 4,
      ended_at: null, last_active: 999, is_active: false, message_count: 2, tool_call_count: 0, input_tokens: 1,
      output_tokens: 1, preview: "second",
    };
    const lookups: Array<{ scope: object; result: Deferred<SessionsResponse> }> = [];
    let pollOverview: (() => void) | undefined;
    const nativeSetInterval = globalThis.setInterval;
    vi.spyOn(globalThis, "setInterval").mockImplementation(
      ((handler: TimerHandler, timeout?: number) => {
        if (timeout === 5000 && typeof handler === "function") {
          pollOverview = handler as () => void;
          return 1;
        }
        return nativeSetInterval(handler, timeout);
      }) as typeof setInterval,
    );
    const poll = async () => {
      const callback = pollOverview;
      if (!callback) throw new Error("overview poll was not installed");
      await act(async () => callback());
    };
    const settle = async (
      request: Deferred<SessionsResponse>,
      sessions?: Record<string, unknown>[],
    ) => {
      await act(async () => {
        if (sessions) {
          request.resolve(sessionsResponse(sessions));
          await request.promise;
        } else {
          request.reject(new Error("recent lookup failed"));
          await request.promise.catch(() => {});
        }
      });
    };

    apiMocks.getSessionStats.mockReturnValue(new Promise(() => {}));
    await renderSessionsPage([staleSameScope, newerSameScope, currentScope], {
      pageTwo: [pageTwo],
      search: [pageTwo, currentScope],
      total: 21,
      recentLookup: (scope) => {
        const result = deferred<SessionsResponse>();
        lookups.push({ scope, result });
        return result.promise;
      },
    });
    await waitFor(() => lookups.length === 1);

    await poll();
    await waitFor(() => lookups.length === 2);
    expect(lookups[1].scope).toBe(lookups[0].scope);
    await settle(lookups[1].result, [newerSameScope]);
    await waitFor(() => document.body.textContent?.includes("Most recent") ?? false);
    expect(document.body.textContent).toContain("Newer same scopeMost recent");
    await settle(lookups[0].result, [staleSameScope]);
    expect(document.body.textContent).toContain("Newer same scopeMost recent");
    expect(document.body.textContent).not.toContain("Stale same scopeMost recent");

    await poll();
    await waitFor(() => lookups.length === 3);
    const automation = Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Automation",
    );
    await act(async () => click(automation ?? null));
    await waitFor(() => lookups.length === 4);
    expect(lookups[3].scope).not.toBe(lookups[2].scope);
    await settle(lookups[3].result, [currentScope]);
    expect(document.body.textContent).toContain("Current scopeMost recent");
    await settle(lookups[2].result, [staleSameScope]);
    expect(document.body.textContent).toContain("Current scopeMost recent");
    expect(document.body.textContent).not.toContain("Stale same scopeMost recent");

    await poll();
    await waitFor(() => lookups.length === 5);
    await settle(lookups[4].result);
    expect(document.body.textContent).not.toContain("Most recent");

    await poll();
    await poll();
    await waitFor(() => lookups.length === 7);
    await settle(lookups[6].result, [currentScope]);
    await settle(lookups[5].result);
    expect(document.body.textContent?.match(/Most recent/g)).toHaveLength(1);
    expect(document.body.textContent).toContain("Current scopeMost recent");

    await act(async () => click(button("Next page")));
    await waitFor(() => document.body.textContent?.includes("Page two local max") ?? false);
    expect(document.body.textContent).not.toContain("Most recent");

    const input = document.querySelector<HTMLInputElement>('input[placeholder="Search message content..."]');
    if (!input) throw new Error("search input not rendered");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "needle");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitFor(() => document.body.textContent?.includes("Current scope") ?? false);
    expect(document.body.textContent?.match(/Most recent/g)).toHaveLength(1);
    expect(document.body.textContent).toContain("Current scopeMost recent");
    expect(document.body.textContent).not.toContain("Page two local maxMost recent");
  });
});

describe("SessionsPage per-row profile routing (#99387)", () => {
  it("sends every per-row request to the row's owning profile, not the management default", async () => {
    await renderSessionsPage([
      { id: "sid-guanli", profile: "guanli", source: "cli", model: null, title: "Managed", started_at: 1, ended_at: null,
        last_active: 1, is_active: false, message_count: 2, tool_call_count: 0, input_tokens: 1, output_tokens: 1, preview: "hi" },
    ]);

    // expand → transcript read
    await act(async () => click(button("Delete session")!.closest("div.cursor-pointer")));
    await waitFor(() => apiMocks.getSessionMessages.mock.calls.length > 0);
    expect(apiMocks.getSessionMessages).toHaveBeenCalledWith("sid-guanli", "guanli");

    await act(async () => click(button("Export session")));
    expect(apiMocks.exportSessionUrl).toHaveBeenCalledWith("sid-guanli", "guanli");

    await act(async () => click(button("Rename session")));
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Session title"]');
    if (!input) throw new Error("rename input not rendered");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Renamed");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => click(button("Save title")));
    expect(apiMocks.renameSession).toHaveBeenCalledWith("sid-guanli", "Renamed", "guanli");

    await act(async () => click(button("Delete session")));
    await waitFor(() => Boolean(document.querySelector('[role="alertdialog"]')));
    const confirm = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(
      (b) => b.textContent?.trim() === "Delete",
    );
    await act(async () => click(confirm ?? null));
    expect(apiMocks.deleteSession).toHaveBeenCalledWith("sid-guanli", "guanli");
  });
});
