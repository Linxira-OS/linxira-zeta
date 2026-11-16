import type { ClientInteraction, InteractionResponseValue } from "@linxiraos/studio-contract";

/** The shared Ask deck submits display labels; evaluation review leases use opaque option ids. */
export function evaluationResponseValue(interaction: ClientInteraction, value: InteractionResponseValue | undefined): unknown {
  if (interaction.kind !== "ask" || !value || typeof value !== "object" || !("results" in value) || !Array.isArray(value.results)) return value;
  return {
    ...value,
    results: value.results.map(answer => {
      if (!answer || typeof answer !== "object" || typeof answer.id !== "string" || !Array.isArray(answer.selectedOptions)) return answer;
      const question = interaction.questions.find(item => item.id === answer.id);
      if (!question) return answer;
      return {
        ...answer,
        selectedOptions: answer.selectedOptions.map((label: unknown) => question.options.find(option =>
          option.label === label || option.label === `${label} (Recommended)`,
        )?.id ?? label),
      };
    }),
  };
}
