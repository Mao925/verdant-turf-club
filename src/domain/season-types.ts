import type {
  Career,
  Opportunity,
  Race,
  Route,
  TrainerId,
} from "./career-types.ts";
export type HorsePlan = Pick<
  Career,
  "nextReview" | "route" | "horseGoal" | "annualGoal"
> & { trainerId?: TrainerId };
export type Portfolio = {
  plans: Record<string, HorsePlan>;
  startedDate: string;
  cohortYear: number;
  marketOpened?: string;
};
export type CourseName = "東京" | "中山" | "京都" | "阪神" | "中京";
export type RaceClass =
  "新馬" | "未勝利" | "1勝クラス" | "2勝クラス" | "3勝クラス" | "オープン";
export type RaceTerms = {
  route: Route;
  minAge: number;
  maxAge: number;
  female: boolean;
  grade: "一般" | "OP" | "GIII" | "GII" | "GI";
  capacity: number;
  firstYen: number;
  selection: "lottery" | "earnings" | "derby" | "fans";
  key: string;
};
export type SeasonOpportunity = Opportunity & { terms: RaceTerms };
export type SeasonRace = Race & {
  terms: RaceTerms;
  applicantCount: number;
  entries: string[];
  ownedIds: string[];
  excludedIds: string[];
  cancelledIds: string[];
  selectionNotes: Record<string, string>;
  finish?: string[];
  times?: number[];
  awards?: Record<
    string,
    {
      cashYen: number;
      earnedYen: number;
      mainYen: number;
      allowanceYen: number;
    }
  >;
};
export type NpcOwner = {
  kind: "npc-owner";
  id: string;
  name: string;
  silk: string;
  policy: string;
  spacingDays: number;
};
export type SeasonCommand =
  | { type: "upgrade-season" }
  | { type: "select-horse"; horseId: string }
  | { type: "open-market" }
  | { type: "close-market" };
