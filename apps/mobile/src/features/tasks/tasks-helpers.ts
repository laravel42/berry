export function isGroupCollapsed(collapsed: Record<string, boolean>, status: string): boolean {
  return collapsed[status] === true;
}

export function toggleGroupCollapsed(
  collapsed: Record<string, boolean>,
  status: string,
): Record<string, boolean> {
  return {
    ...collapsed,
    [status]: !isGroupCollapsed(collapsed, status),
  };
}
