<script>
  let count = 0;
  let name = 'world';

  function increment() {
    count += 1;
  }
</script>

<main>
  <h1>Hello {name}!</h1>
  <button on:click={increment}>
    Count: {count}
  </button>
</main>
