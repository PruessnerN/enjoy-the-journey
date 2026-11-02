/** A planning problem the user can fix by changing their request (HTTP 422). */
export class PlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanningError';
  }
}
