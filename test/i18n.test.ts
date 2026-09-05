import { describe, expect, it } from "vitest";
import { resolveLanguage, translate } from "@/i18n";

describe("internationalization", () => {
  it("defaults to Chinese and translates the primary workflow", () => {
    expect(resolveLanguage(null)).toBe("zh-CN");
    expect(resolveLanguage("unexpected")).toBe("zh-CN");
    expect(translate("zh-CN", "Untitled circuit")).toBe("未命名电路");
    expect(translate("zh-CN", "Run")).toBe("运行");
  });

  it("uses source English as the fallback dictionary", () => {
    expect(resolveLanguage("en")).toBe("en");
    expect(translate("en", "Untitled circuit")).toBe("Untitled circuit");
    expect(translate("zh-CN", "v(out)")).toBe("v(out)");
  });
});
