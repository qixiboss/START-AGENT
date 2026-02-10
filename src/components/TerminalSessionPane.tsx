import { useEffect, useRef } from "react";
import { FitAddon } from "xterm-addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { electronApi } from "../services/electronApi";

type TerminalSessionPaneProps = {
  sessionId: string;
  active: boolean;
  hidden: boolean;
  title: string;
  showHeader: boolean;
  onActivate: () => void;
  onClose: () => void;
};

export const TerminalSessionPane = ({
  sessionId,
  active,
  hidden,
  title,
  showHeader,
  onActivate,
  onClose
}: TerminalSessionPaneProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) {
      return;
    }

    const term = new Terminal({
      convertEol: true,
      fontFamily: "Consolas, 'Cascadia Code', monospace",
      fontSize: 14,
      cursorBlink: true,
      theme: {
        background: "#04070e",
        foreground: "#d7e5ff"
      }
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    const sendResize = (): void => {
      const cols = Math.max(term.cols, 2);
      const rows = Math.max(term.rows, 2);
      electronApi.resizeTerminal(sessionId, cols, rows);
    };

    sendResize();
    term.onData((data) => {
      electronApi.writeTerminal(sessionId, data);
    });

    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      sendResize();
    });
    ro.observe(containerRef.current);

    const offData = electronApi.onTerminalData((event) => {
      if (event.sessionId === sessionId) {
        term.write(event.chunk);
      }
    });

    const offExit = electronApi.onTerminalExit((event) => {
      if (event.sessionId === sessionId) {
        term.writeln(`\r\n[Session exited with code ${event.code}]`);
      }
    });

    const offError = electronApi.onTerminalError((event) => {
      if (event.sessionId === sessionId) {
        term.writeln(`\r\n[Session error] ${event.message}`);
      }
    });

    return () => {
      ro.disconnect();
      offData();
      offExit();
      offError();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!active || !fitAddonRef.current) {
      return;
    }
    fitAddonRef.current.fit();
    const terminal = terminalRef.current;
    if (terminal) {
      electronApi.resizeTerminal(sessionId, terminal.cols, terminal.rows);
      terminal.focus();
    }
  }, [active, sessionId]);

  return (
    <div
      className={`terminal-pane ${active ? "active" : ""} ${hidden ? "hidden" : ""}`}
      onMouseDown={onActivate}
    >
      {showHeader ? (
        <div className="terminal-pane-header">
          <span className="terminal-pane-title">{title}</span>
          <button
            className="btn secondary terminal-pane-close"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            Close
          </button>
        </div>
      ) : null}
      <div className="terminal-pane-body">
        <div className="terminal-root" ref={containerRef} />
      </div>
    </div>
  );
};
