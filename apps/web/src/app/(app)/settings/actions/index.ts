'use server';

// Barrel re-export so existing call sites `from './actions'` continue to work
// after the per-domain split. Each underlying file carries its own
// `'use server'` directive.
export { updateWorkspace, type UpdateWorkspaceState } from './workspace';
export { updateOrgPreferences, type UpdateOrgPreferencesState } from './preferences';
export {
  deleteWorkspace,
  leaveWorkspace,
  type DeleteWorkspaceState,
  type LeaveWorkspaceState,
} from './lifecycle';
