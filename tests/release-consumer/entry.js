const status = document.querySelector('#status');
status.textContent = 'Entry loaded';

document.querySelector('#load').addEventListener('click', async () => {
  const { message } = await import('./lazy.js');
  status.textContent = message;
});
