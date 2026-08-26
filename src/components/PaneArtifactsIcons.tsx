function FolderIcon() {
  return (
    <svg
      className="pane-artifacts-icon-svg"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.2 1.2A1 1 0 0 0 7.8 4.5H12.5A1.5 1.5 0 0 1 14 6v6.5A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5V4.5Z"
      />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      className="pane-artifacts-icon-svg"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm5.2 6.5H10.6c-.1-1.6-.5-3.1-1.1-4.3A5.2 5.2 0 0 1 13.2 8ZM8 2.7c.7 1.1 1.2 2.6 1.4 4.3H6.6C6.8 5.3 7.3 3.8 8 2.7ZM5.5 3.7c-.6 1.2-1 2.7-1.1 4.3H2.8a5.2 5.2 0 0 1 2.7-4.3ZM2.8 9h1.6c.1 1.6.5 3.1 1.1 4.3a5.2 5.2 0 0 1-2.7-4.3Zm3.1 0h2.8c-.2 1.7-.7 3.2-1.4 4.3-.7-1.1-1.2-2.6-1.4-4.3Zm4.2 4.3c.7-1.1 1.2-2.6 1.4-4.3h2.6a5.2 5.2 0 0 1-4 4.3Z"
      />
    </svg>
  );
}

export { FolderIcon, GlobeIcon };
