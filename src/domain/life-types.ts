import type { TrainerId } from "./career-types.ts";
export type LifeState = {
  racing: "active" | "retired" | "barred";
  owners: { ownerId: string; from: string; to?: string }[];
  lastTrainer?: TrainerId;
  episodeId?: string;
  tendonHistoryId?: string;
  movementId?: string;
  saleId?: string;
  deceased?: {
    date: string;
    episodeId: string;
    mode: "natural" | "euthanasia";
  };
};
export type LifeCareer = {
  startedDate: string;
  closure?: {
    date: string;
    cashYen: number;
    debtYen: number;
    unplacedIds: string[];
    reason: string;
  };
};
export type HealthCause =
  "soreness" | "tendon" | "fracture" | "catastrophic" | "colic" | "checkup";
export type HealthEpisode = {
  kind: "health";
  id: string;
  horseId: string;
  date: string;
  origin: "race" | "training" | "pasture" | "illness" | "checkup";
  cause: HealthCause;
  raceId?: string;
  recurrenceOf?: string;
  phase: "assessment" | "decision" | "rehab" | "cleared" | "limited" | "dead";
  outcome: "recover" | "limited" | "death";
  dueDate?: string;
  closedDate?: string;
  diagnosis: string;
  prognosis: string;
  review: number;
  secondOpinion: boolean;
  acknowledged: boolean;
  choice?: string;
  reason?: string;
};
export type Placement = {
  kind: "placement";
  id: string;
  horseId: string;
  date: string;
  purpose: "rest" | "rehab" | "retirement" | "training" | "sale";
  status:
    | "searching"
    | "offered"
    | "unavailable"
    | "moving"
    | "completed"
    | "cancelled";
  dueDate: string;
  targetId?: string;
  priceYen?: number;
  reason: string;
};
export type Scene = {
  kind: "scene";
  id: string;
  horseId: string;
  date: string;
  personId: string;
  trigger:
    | "care"
    | "agreement"
    | "transfer"
    | "retirement"
    | "loss"
    | "reunion"
    | "annual"
    | "sale"
    | "payment";
  evidenceIds: string[];
  text: string;
  reply?: string;
  replyDate?: string;
};
export type LifeEntity = HealthEpisode | Placement | Scene;
export type LifeCommand =
  | { type: "upgrade-life" }
  | { type: "examine"; horseId: string; reason: string }
  | { type: "second-opinion"; episodeId: string; reason: string }
  | {
      type: "care-plan";
      episodeId: string;
      choice: "rehab" | "retire";
      reason: string;
      providerId: string;
    }
  | { type: "acknowledge-health"; episodeId: string }
  | {
      type: "move-horse";
      horseId: string;
      purpose: "rest" | "retirement" | "training";
      providerId: string;
      reason: string;
    }
  | { type: "seek-buyer"; horseId: string; reason: string }
  | {
      type: "sale-response";
      placementId: string;
      accept: boolean;
      reason: string;
    }
  | { type: "extend-payment"; invoiceId: string; reason: string }
  | { type: "remember"; sceneId: string; text: string };
