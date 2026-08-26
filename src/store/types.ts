export type PaneState = {
  id: string;
  cwd: string;
  cliId: string;
  flex: number;
  label: string;
  canResume: boolean;
  cliSessionId?: string | null;
  /** Max transcript seq at first bind; only later entries collected when not resuming. */
  artifactsSinceSeq?: number | null;
  /** ↻ / layout-bound resume: show full session history, not only post-bind. */
  artifactsIncludeHistory?: boolean;
  continueDismissed?: boolean;
  resumeOfferPending?: boolean;
  activityArmed?: boolean;
  busy?: boolean;
  knownBefore?: string[];
};

export type GroupState = {
  id: string;
  paneIds: string[];
  focusId: string;
  customTitle?: string | null;
  unread?: boolean;
  busy?: boolean;
};

export type LayoutSnap = {
  groups: {
    customTitle?: string | null;
    panes: {
      cwd: string;
      cliId: string;
      flex: number;
      cliSessionId?: string | null;
    }[];
  }[];
  activeGroupIndex: number;
};
