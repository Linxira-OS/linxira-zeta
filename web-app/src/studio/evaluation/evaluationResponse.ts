import type { ClientInteraction, InteractionResponseValue } from "@linxiraos/studio-contract";

/** The shared Ask deck submits display labels; evaluation review leases use opaque option ids. */
export function evaluationResponseValue(interaction: ClientInteraction, value: InteractionResponseValue | undefined): unknown {
  if (interaction.kind !== "ask" || !value || typeof value !== "object" || !("results" in value) || !Array.isArray(value.results)) return value;
  return {
    ...value,
    results: value.results.map((answer: unknown) => {
      if (!answer || typeof answer !== "object") return answer;
      const row = answer as { readonly id?: unknown; readonly selectedOptions?: unknown };
      if (typeof row.id !== "string" || !Array.isArray(row.selectedOptions)) return answer;
      const question = interaction.questions.find(item => item.id === row.id);
      if (!question) return answer;
      return {
        ...row,
        selectedOptions: row.selectedOptions.map((label: unknown) => question.options.find(option =>
          option.label === label || option.label === `${label} (Recommended)`,
        )?.id ?? label),
      };
    }),
  };
}
