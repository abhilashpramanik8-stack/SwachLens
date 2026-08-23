export type Status =
  | "reported"
  | "analyzing"
  | "analyzed"
  | "assigned"
  | "en_route"
  | "on_site"
  | "resolved";
export type Volume = "small" | "medium" | "large" | "very_large";
export interface Issue {
  id: string;
  referenceId: string;
  campusId: string;
  latitude: number;
  longitude: number;
  description?: string;
  imageUrl?: string;
  imageHash?: string;
  category: string;
  volumeClass: Volume;
  confidence: number;
  imageProcessingScore: number;
  severity: number;
  priority: number;
  status: Status;
  manualReviewRequired: boolean;
  reportCount: number;
  sourceReportIds: string[];
  duplicateIssueIds: string[];
  crewId?: string;
  etaMinutes?: number;
  estimatedResponseMinutes?: number;
  crewEtaMinutes?: number;
  distanceToAdminKm?: number;
  distanceToCrewKm?: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  aiExplanation: string;
  aiProvider?: string;
}
export interface Campus {
  id: string;
  number: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  active: boolean;
}
export interface Crew {
  id: string;
  name: string;
  capability: string;
  workers: number;
  status: "available" | "assigned" | "en_route" | "on_site";
  latitude: number;
  longitude: number;
  specialties?: string[];
}
export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}
export interface Report {
  id: string;
  issueId: string;
  userId: string;
  campusId: string;
  latitude: number;
  longitude: number;
  description?: string;
  imageUrl?: string;
  category: string;
  createdAt: string;
  duplicateOfIssueId?: string;
}

export interface PasswordResetToken {
  id: string;
  userId: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}
