// Fetches tasks from the API and renders the list. Kept intentionally small.

const list = document.getElementById('task-list');
const form = document.getElementById('add-form');
const input = document.getElementById('add-input');

async function load() {
  const res = await fetch('/api/tasks');
  const tasks = await res.json();
  while (list.firstChild) list.removeChild(list.firstChild);
  for (const task of tasks) {
    const li = document.createElement('li');
    li.textContent = task.title;
    li.className = task.done ? 'done' : '';
    li.addEventListener('click', async () => {
      await fetch(`/api/tasks/${task.id}`, { method: 'PATCH' });
      load();
    });
    list.appendChild(li);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  input.value = '';
  load();
});

load();
