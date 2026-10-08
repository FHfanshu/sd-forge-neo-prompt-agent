<script lang="ts">
  import { ICONS } from "./icons";

  let { name, size = 16, spin = false }: { name: string; size?: number; spin?: boolean } = $props();
</script>

<svg
  class="pa-icon"
  class:pa-spin={spin}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={name === "stop" ? "currentColor" : "none"}
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each ICONS[name] ?? [] as d}<path {d} />{/each}
</svg>
