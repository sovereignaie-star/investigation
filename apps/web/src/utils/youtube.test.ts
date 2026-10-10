import { describe, expect, it } from "vitest";
import { youtubeId } from "./youtube";

describe("youtubeId (CodeQL js/incomplete-url-substring-sanitization)", () => {
  it("accepts real YouTube hosts", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
  });
  it("rejects look-alike hosts, other schemes and bad ids", () => {
    expect(youtubeId("https://evil.example/?u=youtube.com&v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeId("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeId("javascript:alert(1)//youtube.com")).toBeNull();
    expect(youtubeId("https://www.youtube.com/watch?v=<script>")).toBeNull();
    expect(youtubeId("not a url")).toBeNull();
  });
});
