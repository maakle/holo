/**
 * Response shapes for the slice of the Google Drive v3 API we use. Narrow on
 * purpose — only the fields we project into chunks/metadata are typed.
 *
 * Reference: https://developers.google.com/drive/api/reference/rest/v3/files
 */

export interface DriveAboutUser {
  emailAddress: string;
  displayName: string;
  permissionId: string;
}

export interface DriveAbout {
  user: DriveAboutUser;
}

export interface DriveOwner {
  emailAddress: string;
  displayName: string;
  permissionId: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  createdTime: string;
  webViewLink?: string;
  iconLink?: string;
  size?: string;
  trashed?: boolean;
  parents?: string[];
  driveId?: string;
  owners?: DriveOwner[];
  lastModifyingUser?: DriveOwner;
  shortcutDetails?: { targetId: string; targetMimeType: string };
}

export interface DriveFilesPage {
  nextPageToken?: string;
  incompleteSearch?: boolean;
  files: DriveFile[];
}

export interface SharedDrive {
  id: string;
  name: string;
}

export interface SharedDrivesPage {
  nextPageToken?: string;
  drives: SharedDrive[];
}
