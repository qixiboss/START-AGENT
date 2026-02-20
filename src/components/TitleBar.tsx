import { useEffect, useState } from "react";
import { desktopApiAvailable, electronApi } from "../services/electronApi";

const TitleBar = (): JSX.Element => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!desktopApiAvailable) {
      return;
    }
    const updateMaximizedState = async () => {
      const result = await electronApi.isMaximized();
      setIsMaximized(result.isMaximized);
    };
    updateMaximizedState();
  }, []);

  const handleMinimize = (): void => {
    void electronApi.minimizeWindow();
  };

  const handleMaximize = (): void => {
    void electronApi.maximizeWindow().then(async () => {
      const result = await electronApi.isMaximized();
      setIsMaximized(result.isMaximized);
    });
  };

  const handleClose = (): void => {
    void electronApi.closeWindow();
  };

  return (
    <div className="title-bar">
      <div className="title-bar-left">
        <svg
          className="title-bar-icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 2L2 7L12 12L22 7L12 2Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M2 17L12 22L22 17"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M2 12L12 17L22 12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="title-bar-title">START-AGENT</span>
      </div>
      <div className="title-bar-drag-region" />
      {desktopApiAvailable ? (
        <div className="title-bar-controls">
          <button
            className="window-control window-control-minimize"
            onClick={handleMinimize}
            aria-label="最小化"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="2" y="5" width="8" height="2" rx="1" />
            </svg>
          </button>
          <button
            className={`window-control ${isMaximized ? "window-control-restore" : "window-control-maximize"}`}
            onClick={handleMaximize}
            aria-label={isMaximized ? "还原" : "最大化"}
          >
            {isMaximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="6" height="6" rx="1" />
                <rect x="4" y="5" width="6" height="6" rx="1" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="2" width="8" height="8" rx="1" />
              </svg>
            )}
          </button>
          <button
            className="window-control window-control-close"
            onClick={handleClose}
            aria-label="关闭"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 2L10 10M10 2L2 10" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default TitleBar;
