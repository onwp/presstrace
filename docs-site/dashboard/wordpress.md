# WordPress

The **WordPress** page shows which plugins and themes use the most time. This is the page to open when a site is slow and you do not know why.

![The WordPress page: the slowest plugins and themes table with self time share, total, max, average per request, callback calls and rate; below it the slowest callbacks table](/screenshots/wordpress.png){.shot}

## Self time

PressTrace times the hook callbacks of every plugin and theme and adds the load time of its main file. The result is the self time of the component: the time spent in its own code, including the queries and external calls that code made, but not the time of other plugins it calls through hooks.

Core callbacks are not timed, so WordPress core does not appear in this table.

## Slowest plugins and themes

| Column | Meaning |
|---|---|
| Plugin or theme | The folder name (slug) and whether it is a plugin, must-use plugin, theme or drop-in. |
| Self time % | Share of all plugin and theme time in the range. |
| Total | Sum of self time. |
| Max | The highest self time in one request. |
| Avg per request | Self time per request. |
| Callback calls | How many times its hook callbacks ran. |
| Rate per min | Requests per minute in which it ran. |

Click a name to see sample requests where that component used the most time.

## Slowest callbacks

Hook callbacks of plugins and themes that took 1 ms or more, with the hook they ran on (for example `action:wp` or `filter:the_content`), the component, the number of calls, and total, average and maximum time. Click a callback for samples.

Shorter calls are not listed one by one. Their time is included in the component's self time above.

## Plugin and theme load times

How long it takes to include each plugin's main file and to set up the theme, before any hook runs. A plugin that loads slowly does heavy work at include time, on every request.
