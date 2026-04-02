import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CINENERDLE_ITEM_ATTRS_STORAGE_KEY,
  CINENERDLE_ITEM_ATTRS_UPDATED_EVENT,
  addItemAttrToTarget,
  getCinenerdleItemAttrTargetFromCard,
  normalizeItemAttrChars,
  readCinenerdleItemAttrs,
  replaceItemAttrsForReferencedTargets,
} from "../item_attrs";

describe("item attrs", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    const eventTarget = new EventTarget();

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        clear: () => {
          storage.clear();
        },
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => {
          storage.delete(key);
        },
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: eventTarget.addEventListener.bind(eventTarget),
        dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
        localStorage: globalThis.localStorage,
        removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      },
    });
  });

  it("normalizes the persisted storage shape", () => {
    window.localStorage.setItem(
      CINENERDLE_ITEM_ATTRS_STORAGE_KEY,
      JSON.stringify({
        film: {
          "603": ["🔥", "🔥", " ", "⭐"],
          "": ["x"],
        },
        person: {
          "1158": "🎭🎭🧠",
        },
      }),
    );

    expect(readCinenerdleItemAttrs()).toEqual({
      film: {
        "603": ["🔥", "⭐"],
      },
      person: {
        "1158": ["🎭", "🧠"],
      },
    });
  });

  it("maps internal movie keys to the public film bucket", () => {
    expect(getCinenerdleItemAttrTargetFromCard({
      key: "movie:603",
      kind: "movie",
      name: "The Matrix",
    })).toEqual({
      bucket: "film",
      id: "603",
      name: "The Matrix",
    });
  });

  it("dedupes attrs while preserving first-seen order", () => {
    expect(normalizeItemAttrChars(["🔥", "⭐", "🔥", "🧠"])).toEqual(["🔥", "⭐", "🧠"]);
  });

  it("dispatches a same-tab update event when attrs change", () => {
    const listener = vi.fn();
    globalThis.window.addEventListener(CINENERDLE_ITEM_ATTRS_UPDATED_EVENT, listener);

    addItemAttrToTarget({
      bucket: "film",
      id: "603",
      name: "The Matrix",
    }, "🔥");

    expect(listener).toHaveBeenCalledTimes(1);
    globalThis.window.removeEventListener(CINENERDLE_ITEM_ATTRS_UPDATED_EVENT, listener);
  });

  it("replaces only referenced targets while preserving unrelated attrs", () => {
    window.localStorage.setItem(
      CINENERDLE_ITEM_ATTRS_STORAGE_KEY,
      JSON.stringify({
        film: {
          "603": ["🔥"],
          "680": ["⭐"],
        },
        person: {
          "1158": ["🎭"],
        },
      }),
    );

    replaceItemAttrsForReferencedTargets(
      [
        { bucket: "film", id: "603", name: "The Matrix" },
        { bucket: "person", id: "1158", name: "Keanu Reeves" },
      ],
      {
        film: {
          "603": ["🧠"],
        },
        person: {},
      },
    );

    expect(readCinenerdleItemAttrs()).toEqual({
      film: {
        "603": ["🧠"],
        "680": ["⭐"],
      },
      person: {},
    });
  });
});
