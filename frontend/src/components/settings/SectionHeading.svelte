<script lang="ts">
  let { title, hint }: { title?: string; hint: string } = $props();
</script>
<div class="pa-profile-section-heading">{#if title}<h3>{title}</h3>{/if}<p>{hint}</p></div>
