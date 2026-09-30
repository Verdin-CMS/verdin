// The `tienda-polls` dashboard widget: open polls and their vote totals, from the plugin's
// own route (what a Strapi admin widget registered with `app.widgets.register` showed).
class TiendaPolls extends HTMLElement {
  set context(context) {
    this.textContent = 'Loading…';
    // A content API path: sent without the admin's session, answered by the plugin.
    context
      .fetch(`${context.apiBase}/plugins/tienda/polls`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then(({ data }) => this.render(data))
      .catch((error) => {
        this.textContent = `Could not load the polls (${error})`;
      });
  }

  render(polls) {
    if (!polls.length) {
      this.textContent = 'No open polls.';
      return;
    }
    const list = document.createElement('ul');
    list.style.margin = '0';
    list.style.paddingLeft = '1.2em';
    for (const poll of polls) {
      const item = document.createElement('li');
      item.textContent = `${poll.titulo}: ${poll.total} vote${poll.total === 1 ? '' : 's'}`;
      list.append(item);
    }
    this.replaceChildren(list);
  }
}

customElements.define('tienda-polls', TiendaPolls);
