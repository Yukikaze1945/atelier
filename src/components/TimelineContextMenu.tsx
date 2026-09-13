import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface TimelineMenuItem {
  label: string;
  action?: () => void;
  disabled?: boolean;
  field?: { label: string; value: string; save: (value: string) => void };
}
export function TimelineContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: TimelineMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [field, setField] = useState<TimelineMenuItem["field"]>();
  useEffect(() => {
    const click = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", click);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", click);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="timeline-context-menu"
      style={{
        left: Math.min(x, window.innerWidth - 275),
        top: Math.max(
          8,
          Math.min(
            y,
            window.innerHeight - Math.min(items.length * 30 + 14, 560),
          ),
        ),
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {field ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            field.save(new FormData(e.currentTarget).get("value") as string);
            onClose();
          }}
        >
          <label>
            {field.label}
            <input autoFocus name="value" defaultValue={field.value} />
          </label>
          <button type="submit">确定</button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </form>
      ) : (
        items.map((item, i) => (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.field) setField(item.field);
              else {
                item.action?.();
                onClose();
              }
            }}
          >
            {item.label}
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
