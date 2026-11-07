# NocPortal

NocPortal is a shift console for a network operations center. It puts live monitoring, the people on shift, the day's work, and management dashboards on one screen, so a shift does not have to jump between disconnected tools.

The public site is a short product page. After sign-in, administrators and NOC operators open the operations portal. Dashboard users open only the boards granted to their account.

## Requirements

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)

## Run

```bash
dotnet run
```

Local URLs are defined in `Properties/launchSettings.json`:

- https://localhost:7262
- http://localhost:5097

The root URL serves the product page. Signed-in users are sent to the portal or to their dashboards.

## Access

| Role | After sign-in |
| --- | --- |
| Admin | Operations portal, dashboards, and user administration |
| NOC | Operations portal and dashboards |
| Dashboard | Dashboards granted to that account |

New accounts stay inactive until an administrator approves them. Sign-in uses an HTTP-only cookie with an eight-hour sliding expiration.

## What the shift sees

At a high level, the portal covers:

- Live monitoring alerts, with search, severity, and status
- The current shift, the weekly roster, and a daily checklist
- Procedures, a phone directory, and shift messages
- Wall and management dashboards, scoped by role

Signed-in users can open `/features` for a catalog of each screen.

## Stack

- ASP.NET Core 8 MVC
- Cookie authentication
- Server-rendered views, with vanilla JavaScript on the client
- Operational data stored as JSON
- Chart.js on the dashboards

Integration secrets in `appsettings.json` are stored encrypted (`ENC:`) and must stay that way in git.

## Layout

```
Controllers/     MVC controllers
Models/          Domain models and application services
Views/           Product page, portal, dashboards, administration
wwwroot/         Styles, client scripts, and the feature catalog
Program.cs
Startup.cs
appsettings.json
```

## Security

- Role-based access, with approval required before an account can sign in
- HTTP-only authentication cookie
- Encrypted integration secrets in configuration

Inquiries from the public product page open a ready Gmail draft. The application does not send them.
