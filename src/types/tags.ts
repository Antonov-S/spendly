/**
 * A tag option for the drawer picker and the feed filter pill. Mirrors
 * `CategoryOption` but tags have no icon and their color is optional (null →
 * neutral chip). This is also the shape `createTag` returns so a picker can
 * append-and-select an inline-created tag.
 */
export interface TagOption {
  id: string;
  name: string;
  /** Optional hex accent; null renders as a neutral chip. */
  color: string | null;
}

/**
 * A user-owned tag row for the `/settings` manage list, with a usage count that
 * drives both the "used by N transactions" line and the delete-impact dialog.
 * The count scopes to non-deleted transactions (see `getManageableTags`).
 */
export interface ManageableTag {
  id: string;
  name: string;
  color: string | null;
  /** Non-deleted transactions carrying this tag (lose the label on delete). */
  transactionCount: number;
}

/** Editable shape used to pre-fill the tag drawer in edit mode. */
export interface EditableTag {
  id: string;
  name: string;
  color: string | null;
}
