// Note types, and checking a note against one.
//
// A type says which categorized facts and typed links a well-formed note of
// that kind carries. It describes a subset, never a straitjacket: an
// observation or relation the type does not mention is fine, and validation
// only ever warns. A store whose writes can be rejected stops being written to,
// and a memory nobody writes to is worse than an untidy one.
//
// The types map onto the syntax already in `note.mjs`, so nobody writing a note
// learns anything new:
//
//   field            -> an observation, `- [field] value`
//   field (array)    -> the same category repeated
//   field (relation) -> `- field [[Target]]`
//   frontmatter      -> a key in the note's frontmatter
//
// Why three types and not one: they answer different questions. `decision` is
// what was chosen and what it rules out, `session` is where the work stopped,
// `lesson` is what not to do again. Structured recall asks for exactly one of
// those at a time — "open decisions", "where did we leave off" — and a single
// undifferentiated note type cannot answer any of them.

/**
 * @typedef {object} Field
 * @property {"observation" | "relation" | "frontmatter"} where
 * @property {boolean} [required]
 * @property {string} [requiredWhile] only required while a frontmatter field
 *   matches, written `key=value` — see `decision` below for why
 * @property {boolean} [array]   observations only: repeat the category
 * @property {string[]} [values] frontmatter only: the allowed set
 * @property {string} why        what this field is for, shown in the report
 */

/** @type {Record<string, { description: string, fields: Record<string, Field> }>} */
export const TYPES = {
  decision: {
    description: "A choice with alternatives and a rationale — not a passing preference.",
    fields: {
      title: { where: "frontmatter", required: true, why: "what the decision is about" },
      status: {
        where: "frontmatter",
        required: true,
        values: ["open", "accepted", "superseded", "rejected"],
        why: "what makes a decision findable later: a session briefing asks for the open ones",
      },
      decided: { where: "frontmatter", why: "when it was settled (YYYY-MM-DD)" },
      decision: { where: "observation", required: true, why: "the choice, stated plainly" },
      // Required only while the decision is still open, and that is not a
      // concession: an open decision without its reasoning cannot be revisited,
      // which is the entire point of recording it. A settled one from two
      // months ago is a record — warning that it lacks a field whose content
      // was never captured, and cannot now be recovered, is noise that teaches
      // the reader to skim the report.
      rationale: {
        where: "observation",
        requiredWhile: "status=open",
        why: "why this one — without it an open decision cannot be revisited",
      },
      alternative: {
        where: "observation",
        array: true,
        requiredWhile: "status=open",
        why: "what was rejected — this, with the rationale, is what stops a later session relitigating the same ground",
      },
      consequence: { where: "observation", array: true, why: "what the choice commits the work to" },
      affects: { where: "relation", why: "the work this decision bears on" },
      supersedes: { where: "relation", why: "the decision this one replaces" },
    },
  },

  session: {
    description: "Where a session got to, so the next one resumes instead of restarting.",
    fields: {
      title: { where: "frontmatter", required: true, why: "the thread, in a few words" },
      status: {
        where: "frontmatter",
        required: true,
        values: ["open", "resumed", "closed"],
        why: "whether this thread is still live",
      },
      task: { where: "frontmatter", why: "the workhub task id, when there is one" },
      summary: { where: "observation", required: true, why: "what happened, in a line" },
      context: { where: "observation", array: true, why: "what a cold session needs to pick this up" },
      next_step: { where: "observation", array: true, required: true, why: "the cursor: what to do next" },
      decision: { where: "observation", array: true, why: "choices made along the way" },
      problem: {
        where: "observation",
        array: true,
        why: "dead ends, including approaches tried and rejected — so the next session does not try them again",
      },
      produced: { where: "relation", why: "the notes this session created or changed" },
    },
  },

  lesson: {
    description: "Something that went wrong once and should not go wrong again.",
    fields: {
      title: { where: "frontmatter", required: true, why: "the trap, named" },
      symptom: { where: "observation", required: true, why: "how it looks from outside — this is what a future search matches on" },
      cause: { where: "observation", required: true, why: "what was actually wrong" },
      instead: { where: "observation", required: true, why: "what to do next time" },
      seen_at: { where: "observation", array: true, why: "where it happened: a file, a task, a date" },
      relates_to: { where: "relation", why: "the subject this belongs to" },
    },
  },
};

/** @typedef {{ level: "warn", field: string, message: string }} Finding */

/**
 * Check a parsed note against its declared type.
 *
 * An unknown or absent `type` is itself worth saying: a note with no type is
 * invisible to structured recall, which is the same as not being there when a
 * session asks what is open.
 *
 * @returns {{ type: string | null, findings: Finding[] }}
 */
export function validateNote(note) {
  const declared = String(note.frontmatter?.type ?? "").trim();
  if (!declared) {
    return {
      type: null,
      findings: [
        {
          level: "warn",
          field: "type",
          message:
            "no `type:` — structured recall cannot see this note, so a session asking for open decisions or recent sessions will never find it",
        },
      ],
    };
  }

  const spec = TYPES[declared];
  if (!spec) {
    return {
      type: declared,
      findings: [
        {
          level: "warn",
          field: "type",
          message: `unknown type \`${declared}\` — known types: ${Object.keys(TYPES).join(", ")}`,
        },
      ],
    };
  }

  const findings = [];
  for (const [name, field] of Object.entries(spec.fields)) {
    const present = valuesFor(note, name, field);
    if (!present.length) {
      if (field.required || conditionMet(note, field.requiredWhile)) {
        findings.push({
          level: "warn",
          field: name,
          message: `missing ${describe(name, field)} — ${field.why}`,
        });
      }
      continue;
    }
    if (field.where === "frontmatter" && field.values && !field.values.includes(present[0])) {
      findings.push({
        level: "warn",
        field: name,
        message: `\`${name}: ${present[0]}\` is not one of ${field.values.join(", ")}`,
      });
    }
    if (field.where === "observation" && !field.array && present.length > 1) {
      findings.push({
        level: "warn",
        field: name,
        message: `${present.length} \`[${name}]\` observations — this field holds one; use a different category, or say it in the body`,
      });
    }
  }
  return { type: declared, findings };
}

/** `key=value` against the note's frontmatter; absent condition means never. */
function conditionMet(note, condition) {
  if (!condition) return false;
  const [key, value] = condition.split("=");
  return String(note.frontmatter?.[key] ?? "") === value;
}

function valuesFor(note, name, field) {
  if (field.where === "frontmatter") {
    const value = note.frontmatter?.[name];
    if (value === undefined || value === null || value === "") return [];
    return Array.isArray(value) ? value : [String(value)];
  }
  if (field.where === "relation") {
    return note.relations.filter((r) => r.type === name).map((r) => r.target);
  }
  return note.observations.filter((o) => o.category === name).map((o) => o.text);
}

function describe(name, field) {
  if (field.where === "frontmatter") return `\`${name}:\` in the frontmatter`;
  if (field.where === "relation") return `a \`${name} [[…]]\` relation`;
  return `a \`[${name}]\` observation`;
}

/** A blank note of one type, ready to fill in. Used by the skills and by `cli.mjs new`. */
export function templateFor(type, title = "<title>") {
  const spec = TYPES[type];
  if (!spec) throw new Error(`unknown type: ${type} (known: ${Object.keys(TYPES).join(", ")})`);

  const frontmatter = ["---", `title: ${title}`, `type: ${type}`];
  for (const [name, field] of Object.entries(spec.fields)) {
    if (field.where !== "frontmatter" || name === "title") continue;
    frontmatter.push(`${name}: ${field.values ? field.values[0] : ""}`);
  }
  frontmatter.push("---", "");

  const observations = [];
  const relations = [];
  for (const [name, field] of Object.entries(spec.fields)) {
    const line = `- ${field.where === "relation" ? `${name} [[…]]` : `[${name}] `}`;
    const marker = field.required || field.requiredWhile ? "" : "  # optional";
    if (field.where === "observation") observations.push(line + marker);
    if (field.where === "relation") relations.push(line + marker);
  }

  return [
    ...frontmatter,
    `# ${title}`,
    "",
    `${spec.description}`,
    "",
    "Write the reasoning here, in prose. Search returns passages from the body,",
    "so a note with context is both easier to find and worth more when found.",
    "",
    "## Observations",
    ...observations,
    "",
    "## Relations",
    ...relations,
    "",
  ].join("\n");
}
