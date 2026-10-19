import * as React from "react";
import { Button, Textarea } from "@ir/ui";

/**
 * P3-004 (UC-02): the free-text input bar. Paste any text; the page runs the real extraction
 * engine over it. Presentational only — the text is handed to `onText` and never stored
 * (D-033: no browser storage).
 */
export function SearchBar({ onText }: { onText: (text: string) => void }) {
  const [value, setValue] = React.useState("");
  return (
    <form
      data-testid="search-bar"
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim().length > 0) onText(value);
      }}
    >
      <label htmlFor="search-text" className="text-sm font-medium">
        الصق نصاً حراً
      </label>
      <Textarea
        id="search-text"
        name="search-text"
        dir="auto"
        rows={4}
        placeholder="الصق النص هنا — نطاقات، عناوين IP، بريد، هواتف، محافظ…"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button type="submit" className="self-end">
        استخراج المعرّفات
      </Button>
    </form>
  );
}
