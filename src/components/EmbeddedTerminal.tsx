import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TerminalSessionInputStateValue } from "../types/ipc";

const RESIZE_NOTIFY_DEBOUNCE_MS = 100;

export type EmbeddedTerminalHandle = {
  focus: () => void;
  scrollToBottom: () => void;
};

type EmbeddedTerminalProps = {
  sessionId: string;
  content: string;
  inputState?: TerminalSessionInputStateValue;
  onResize?: (cols: number, rows: number) => void;
  onData?: (data: string) => void;
};

const EmbeddedTerminal = forwardRef<EmbeddedTerminalHandle, EmbeddedTerminalProps>(({
  sessionId,
  content,
  inputState = "idle",
  onResize,
  onData
}, ref): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const writtenContentRef = useRef("");
  const onResizeRef = useRef(onResize);
  const onDataRef = useRef(onData);
  const imeAnchorRafRef = useRef<number | null>(null);
  const resizeDebounceRef = useRef<number | null>(null);
  const lastNotifiedSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  const anchorImeTextarea = (): void => {
    const terminal = terminalRef.current;
    const container = containerRef.current;
    const textarea = terminal?.textarea;
    if (!terminal || !container || !textarea) {
      return;
    }
    const cursorElement = container.querySelector(".xterm-cursor-layer .xterm-cursor") as HTMLElement | null;
    if (cursorElement) {
      const containerRect = container.getBoundingClientRect();
      const cursorRect = cursorElement.getBoundingClientRect();
      const left = Math.max(0, Math.round(cursorRect.left - containerRect.left));
      const top = Math.max(0, Math.round(cursorRect.top - containerRect.top));
      textarea.style.left = `${left}px`;
      textarea.style.top = `${top}px`;
    } else {
      const cols = Math.max(1, terminal.cols);
      const rows = Math.max(1, terminal.rows);
      const horizontalPadding = 8;
      const verticalPadding = 8;
      const innerWidth = Math.max(1, container.clientWidth - horizontalPadding * 2);
      const innerHeight = Math.max(1, container.clientHeight - verticalPadding * 2);
      const cellWidth = innerWidth / cols;
      const cellHeight = innerHeight / rows;
      const cursorX = Math.max(0, Math.min(cols - 1, terminal.buffer.active.cursorX));
      const cursorY = Math.max(0, Math.min(rows - 1, terminal.buffer.active.cursorY));
      const left = horizontalPadding + Math.floor(cursorX * cellWidth);
      const top = verticalPadding + Math.floor(cursorY * cellHeight);
      textarea.style.left = `${left}px`;
      textarea.style.top = `${top}px`;
    }
    textarea.style.width = "1px";
    textarea.style.height = "1px";
  };

  const scheduleImeAnchor = (): void => {
    if (imeAnchorRafRef.current !== null) {
      window.cancelAnimationFrame(imeAnchorRafRef.current);
    }
    imeAnchorRafRef.current = window.requestAnimationFrame(() => {
      imeAnchorRafRef.current = null;
      anchorImeTextarea();
    });
  };

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      terminalRef.current?.focus();
    },
    scrollToBottom: () => {
      terminalRef.current?.scrollToBottom();
    }
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      cursorInactiveStyle: "outline",
      convertEol: false,
      scrollback: 8000,
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.3,
      drawBoldTextInBrightColors: true,
      theme: {
        background: "#0f1726",
        foreground: "#d9e8ff"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.focus();
    anchorImeTextarea();
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    writtenContentRef.current = "";

    if (content) {
      terminal.write(content);
      writtenContentRef.current = content;
    }

    const notifySize = () => {
      const fit = fitAddonRef.current;
      const term = terminalRef.current;
      if (!fit || !term) {
        return;
      }
      fit.fit();
      anchorImeTextarea();
      const nextSize = { cols: term.cols, rows: term.rows };
      const lastSize = lastNotifiedSizeRef.current;
      if (!lastSize || lastSize.cols !== nextSize.cols || lastSize.rows !== nextSize.rows) {
        lastNotifiedSizeRef.current = nextSize;
        onResizeRef.current?.(nextSize.cols, nextSize.rows);
      }
    };

    const scheduleResize = () => {
      if (resizeDebounceRef.current !== null) {
        window.clearTimeout(resizeDebounceRef.current);
      }
      resizeDebounceRef.current = window.setTimeout(() => {
        resizeDebounceRef.current = null;
        notifySize();
      }, RESIZE_NOTIFY_DEBOUNCE_MS);
    };

    const dataDisposable = terminal.onData((data) => {
      onDataRef.current?.(data);
    });
    const focusHandler = () => setIsFocused(true);
    const blurHandler = () => setIsFocused(false);
    const compositionStartHandler = () => {
      setIsComposing(true);
      scheduleImeAnchor();
    };
    const compositionUpdateHandler = () => {
      scheduleImeAnchor();
    };
    const compositionEndHandler = () => {
      setIsComposing(false);
      scheduleImeAnchor();
    };
    terminal.textarea?.addEventListener("focus", focusHandler);
    terminal.textarea?.addEventListener("blur", blurHandler);
    terminal.textarea?.addEventListener("compositionstart", compositionStartHandler);
    terminal.textarea?.addEventListener("compositionupdate", compositionUpdateHandler);
    terminal.textarea?.addEventListener("compositionend", compositionEndHandler);
    terminal.attachCustomKeyEventHandler((event) => {
      const isPrimaryModifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (!isPrimaryModifier || event.altKey) {
        return true;
      }
      if (key === "c") {
        if (!terminal.hasSelection()) {
          return true;
        }
        const selectedText = terminal.getSelection();
        if (!selectedText) {
          return false;
        }
        void navigator.clipboard.writeText(selectedText).catch(() => undefined);
        return false;
      }
      if (key === "v") {
        void navigator.clipboard.readText().then((text) => {
          if (!text) {
            return;
          }
          onDataRef.current?.(text);
        }).catch(() => undefined);
        return false;
      }
      if (key === "l") {
        onDataRef.current?.("\u000c");
        return false;
      }
      return true;
    });
    notifySize();
    const observer = new ResizeObserver(() => scheduleResize());
    observer.observe(container);
    const onWindowResize = () => scheduleResize();
    window.addEventListener("resize", onWindowResize);

    return () => {
      dataDisposable.dispose();
      terminal.textarea?.removeEventListener("focus", focusHandler);
      terminal.textarea?.removeEventListener("blur", blurHandler);
      terminal.textarea?.removeEventListener("compositionstart", compositionStartHandler);
      terminal.textarea?.removeEventListener("compositionupdate", compositionUpdateHandler);
      terminal.textarea?.removeEventListener("compositionend", compositionEndHandler);
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      writtenContentRef.current = "";
      if (imeAnchorRafRef.current !== null) {
        window.cancelAnimationFrame(imeAnchorRafRef.current);
        imeAnchorRafRef.current = null;
      }
      if (resizeDebounceRef.current !== null) {
        window.clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
      lastNotifiedSizeRef.current = null;
      setIsFocused(false);
      setIsComposing(false);
    };
  }, [sessionId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    const previous = writtenContentRef.current;
    if (content === previous) {
      return;
    }
    if (content.startsWith(previous)) {
      const delta = content.slice(previous.length);
      if (delta) {
        terminal.write(delta);
      }
    } else {
      terminal.reset();
      terminal.write(content);
    }
    writtenContentRef.current = content;
  }, [content]);

  return (
    <div
      className={`embedded-terminal-output state-${inputState} ${isFocused ? "focused" : "blurred"} ${isComposing ? "composing" : ""}`}
      ref={containerRef}
      onClick={() => {
        terminalRef.current?.focus();
        anchorImeTextarea();
      }}
      role="presentation"
    />
  );
});

export default EmbeddedTerminal;
