<script lang="ts">
  import type { Snippet } from "svelte";
  let { label, children }: { label: string; children: Snippet } = $props();
</script>
<details class="pa-profile-more">
  <summary>{label}</summary>
  <div class="pa-profile-more-body">{@render children()}</div>
</details>
