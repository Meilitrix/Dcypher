import type {
  ChangePlan,
  ConflictReport,
  PlannedFileChange,
  PlanConflict,
  ProtectedRule,
} from '@decypher/core';
import { newId } from '@decypher/core';
import { matchGlob } from './glob';

/**
 * Stage 2 core: manages the user's protection boundaries and evaluates conflicts
 * before a plan is applied. Protections are hard boundaries — if a plan needs to touch
 * a protected element, a conflict is produced and handed back to the user rather than
 * the element being silently modified.
 */
export class ProtectionManager {
  private rules: ProtectedRule[] = [];

  /** Return a shallow copy of all current protection rules. */
  list(): ProtectedRule[] {
    return this.rules.map((r) => ({ ...r }));
  }

  /** Add a protection rule. The glob is normalized to forward slashes. */
  add(glob: string, label?: string): ProtectedRule {
    const normalized = glob.replace(/\\/g, '/');
    const rule: ProtectedRule = {
      id: newId('rule'),
      glob: normalized,
      label: label ?? normalized,
      locked: true,
    };
    this.rules.push(rule);
    return rule;
  }

  /** Add/toggle an exact-path rule (used when locking a file directly from the tree). */
  togglePath(relPath: string): ProtectedRule {
    const normalized = relPath.replace(/\\/g, '/');
    const existing = this.rules.find((r) => r.glob === normalized);
    if (existing) {
      existing.locked = !existing.locked;
      return { ...existing };
    }
    return this.add(normalized, normalized);
  }

  remove(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  setLocked(id: string, locked: boolean): void {
    const rule = this.rules.find((r) => r.id === id);
    if (rule) rule.locked = locked;
  }

  /** Find all currently-locked rules that would match a given file. */
  rulesMatching(file: PlannedFileChange): ProtectedRule[] {
    return this.rules.filter((r) => r.locked && matchGlob(r.glob, file.path));
  }

  /** Evaluate a whole plan against the protection rules. */
  evaluate(plan: ChangePlan): ConflictReport {
    const conflicts: PlanConflict[] = [];
    for (const file of plan.files) {
      for (const rule of this.rulesMatching(file)) {
        conflicts.push({
          rule: { ...rule },
          file,
          why: `The plan needs to ${file.action} "${file.path}", which matches protection rule "${rule.label}" (${rule.glob}).`,
          proposedChange: describeChange(file),
        });
      }
    }
    return { planId: plan.id, conflicts, clear: conflicts.length === 0 };
  }

  /** Files that are actually permitted to change: those not hit by a locked rule. */
  permittedFiles(plan: ChangePlan): PlannedFileChange[] {
    return plan.files.filter((f) => this.rulesMatching(f).length === 0);
  }
}

function describeChange(file: PlannedFileChange): string {
  switch (file.action) {
    case 'create':
      return `Create this file: ${file.purpose}`;
    case 'modify':
      return `Modify this file: ${file.purpose}`;
    case 'delete':
      return `Delete this file: ${file.purpose}`;
    default:
      return file.purpose;
  }
}
