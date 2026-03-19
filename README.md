NOC PORTAL - COMPREHENSIVE OPERATIONS MANAGEMENT SYSTEM | MENORA MIVTACHIM


📋 PROJECT DESCRIPTION

A comprehensive NOC (Network Operations Center) portal developed for Menora
Mivtachim, centralizing all operational activities in one accessible platform.
The system enables task tracking, shift management, announcement sharing,
monitoring alerts, server room mapping, and quick access to organizational
procedures and resources.


🌟 BACKGROUND

The NOC Portal was developed to address the operational challenges faced by the
NOC and Data Center team. It replaces multiple disconnected systems, eliminates
unnecessary paperwork, and streamlines communication by providing a single,
accessible platform for managing all NOC operations.


🛠️ TECHNOLOGIES


FRONTEND

 * Vanilla JavaScript (ES6+) - No external frameworks
 * HTML5 - Semantic structure
 * CSS3 - Advanced styling with:
   * Flexbox & CSS Grid
   * CSS Gradients
   * CSS Animations & Transitions
   * Backdrop-filter (Glassmorphism effects)
 * Font Awesome - Icon library
 * localStorage API - User preferences persistence


BACKEND

 * ASP.NET Core / ASP.NET MVC (C#)
 * RESTful API - Client-Server communication
 * JSON - Data transfer format


ARCHITECTURE

 * Client-Side Rendering
 * Class-based JavaScript - Object-oriented code organization
 * Event-driven Programming
 * MVC Pattern - Server-side pattern


INTEGRATIONS

 * Helix Monitoring System
 * ON-IT Change Management System
 * UC4 Automation Platform
 * Jabber Communication System


📁 PROJECT STRUCTURE

NOCPORTAL/ ├── wwwroot/ │ ├── css/ │ │ ├── noc-portal.css # Main portal
stylesheet │ │ ├── site.css # Site-wide styles │ │ └── site.min.css # Minified
styles │ ├── js/ │ │ ├── DailyTasksManager.js # Daily tasks management │ │ ├──
EmployeeTasksManager.js # Employee tasks management │ │ ├── main.js # Main
application logic │ │ ├── MessagesManager.js # Messages/Announcements management
│ │ ├── NOCPortalApp.js # Main portal application │ │ ├── NotificationManager.js
# Notifications system │ │ ├── PhoneDirectoryManager.js # Phone directory
management │ │ ├── ProceduresManager.js # Procedures library management │ │ ├──
SectionManager.js # Section collapse/expand logic │ │ ├── ShiftsManager.js #
Shifts schedule management │ │ ├── ServerRoomManager.js # Server room mapping │
│ ├── MonitoringManager.js # Monitoring alerts management │ │ ├──
ChangesManager.js # Planned changes management │ │ ├── LinksManager.js # Useful
links management │ │ ├── site.js # Site-wide scripts │ │ └── site.min.js #
Minified site scripts │ ├── lib/ # External libraries │ ├── images/ # Image
assets │ ├── procedures/ # Procedures documents │ └── favicon.ico # Site icon
├── Controllers/ │ ├── DailyTasksController.cs # Daily tasks API │ ├──
EmployeeService.cs # Employee service │ ├── EmployeeTasksController.cs #
Employee tasks API │ ├── HomeController.cs # Home page controller │ ├──
MessagesController.cs # Messages/Announcements API │ ├──
PhoneDirectoryController.cs # Phone directory API │ ├── ProceduresController.cs
# Procedures library API │ ├── ShiftsController.cs # Shifts schedule API │ ├──
ServerRoomController.cs # Server room mapping API │ ├── MonitoringController.cs
# Monitoring alerts API │ ├── ChangesController.cs # Planned changes API │ └──
LinksController.cs # Useful links API ├── Models/ # Data models ├── Helpers/ #
Helper classes ├── Views/ │ ├── Home/ │ │ ├── Index.cshtml # Main page │ │ ├──
About.cshtml # About page │ │ ├── Contact.cshtml # Contact page │ │ └──
Privacy.cshtml # Privacy page │ ├── Shared/ │ │ ├── _Layout.cshtml # Main layout
│ │ ├── _ValidationScriptsPartial.cshtml │ │ ├── _CookieConsentPartial.cshtml │
│ ├── Error.cshtml # Error page │ │ ├── _ViewImports.cshtml # View imports │ │
└── _ViewStart.cshtml # View start ├── Properties/ │ └── launchSettings.json #
Launch configuration ├── bin/ # Compiled binaries ├── obj/ # Build objects ├──
appsettings.json # Application settings ├── appsettings.Development.json #
Development settings ├── Program.cs # Application entry point ├── Startup.cs #
Startup configuration ├── MyWebApp.csproj # Project file ├── .gitignore # Git
ignore rules └── README.md # Project documentation


✨ KEY FEATURES


1. SHIFT SCHEDULE

 * 📅 Weekly shift view with automatic updates
 * 🌅 Shift types: Morning, Afternoon, Night, Day Off
 * 📍 Current day indicator
 * 🎨 Color-coded shifts
 * 📧 Email distribution with preview
 * 🔄 Automatic weekly updates
 * 📚 Complete shift history


2. TASK BOARD & ANNOUNCEMENTS

 * 📢 Categorized announcements and tasks
 * 🔖 UC4 Reports with smart data processing
 * 📝 Shift summary with file attachments
 * 🔍 Advanced search and filtering
 * 📊 Task status tracking
 * 📅 Scheduled tasks with automatic alerts
 * 📤 PDF export capabilities


3. PHONE DIRECTORY

 * 📞 Centralized contact database
 * 🔍 Advanced search by name, role, or keywords
 * 📞 Direct Jabber call integration
 * ✉️ One-click email functionality
 * 🔄 Real-time updates


4. DAILY TASKS CHECKLIST

 * ✅ Time-specific task scheduling
 * 🔔 Smart notification system with snooze options
 * 📝 Detailed documentation for non-completion
 * 📅 Day-specific task configuration
 * 🔄 Drag-and-drop reordering
 * 📊 Long-term completion rate tracking


5. PROCEDURES & RUN BOOKS

 * 📚 Centralized knowledge repository
 * 🗂️ Folder-based organization
 * 🔍 Advanced search capabilities
 * 👁️ In-portal document viewing
 * 📋 Direct text/command copying
 * 🔄 Network path integration for editing
 * 💾 Centralized backup system


6. ACTIVITIES MANAGEMENT

 * 📋 Critical cross-functional activity coordination
 * ⏱️ Flexible time-based or free arrangement
 * 🔄 Advanced drag-and-drop capabilities
 * 📥 Excel import for complex activities
 * ✅ Real-time checklist tracking
 * 🔍 Advanced search and filtering
 * 📚 Automatic archiving of completed activities


7. USEFUL LINKS

 * 🔗 Centralized access to digital tools
 * 🗂️ Logical category organization
 * 🔍 Advanced search and filtering
 * ➕ Full link management capabilities
 * 📝 Detailed descriptions and keywords


8. SERVER ROOM MAPPING

 * 🗺️ Interactive maps of server rooms
 * 🔍 Smart search with automatic highlighting
 * 🔌 Advanced connection documentation
 * 📥 Excel import capabilities
 * 🔄 Automatic bi-directional connection updates
 * 🖨️ Advanced export for physical reference
 * ⏱️ Significant time savings for equipment location


9. EMPLOYEE TASKS

 * 👥 Individual project tracking
 * 📊 Smart progress percentage tracking
 * 🔍 Multi-criteria filtering
 * 🎯 Clear task prioritization
 * 📈 Workload visibility for managers


10. PLANNED CHANGES BOARD

 * 📅 Intuitive calendar view
 * 🎨 Visual indicators for days with planned changes
 * 📋 Detailed table view option
 * 🔄 Automatic ON-IT system synchronization
 * 🔗 Direct links to change details


11. MONITORING ALERTS

 * 🔔 Centralized Helix monitoring alerts
 * 🎨 Customizable display and colors
 * 🔍 Advanced filtering by severity and status
 * 🔎 Full-text search across all alert fields
 * 💬 Hover notes preview
 * 📝 Note management with Helix synchronization
 * 📧 Automatic email notifications
 * ✅ Bulk alert processing


📱 DEVICE SUPPORT

 * ✅ Desktop (1920px+)
 * ✅ Laptop (1366px - 1920px)
 * ✅ Tablet (768px - 1366px)
 * ✅ Mobile (320px - 768px)


🎯 ADVANCED FEATURES


PERSONALIZATION

 * 🔧 Widget reordering and prioritization
 * 💾 User preference persistence
 * 🎨 Look and feel aligned with Menora brand


LOCALSTORAGE

 * 💾 Save section collapse state
 * 💾 Save display preferences
 * 💾 Save last used filters


DRAG & DROP

 * 🔄 Reorder tasks
 * 🔄 Reorder announcements
 * 🎨 Visual indication during dragging


REAL-TIME UPDATES

 * 🔄 Real-time progress updates
 * 🔄 Task status updates
 * 🔄 Automatic data refresh


📊 API ENDPOINTS


EMPLOYEE TASKS

GET  /EmployeeTasks/GetEmployees
GET  /EmployeeTasks/GetEmployeeTasks?employeeId={id}&date={date}
POST /EmployeeTasks/AddTask
POST /EmployeeTasks/UpdateTask
POST /EmployeeTasks/UpdateTaskStatus
POST /EmployeeTasks/UpdateTaskProgress
POST /EmployeeTasks/DeleteTask



DAILY TASKS

GET  /Tasks/GetTasks?date={date}
POST /Tasks/AddTask
POST /Tasks/UpdateTask
POST /Tasks/DeleteTask
POST /Tasks/ToggleTaskCompletion
POST /Tasks/UpdateTaskOrder



MESSAGES

GET  /Messages/GetMessages
POST /Messages/AddMessage
POST /Messages/UpdateMessage
POST /Messages/DeleteMessage
POST /Messages/ToggleFavorite



SHIFTS

GET  /Shifts/GetShifts?date={date}
POST /Shifts/UpdateShift



PHONE DIRECTORY

GET  /PhoneDirectory/GetContacts
POST /PhoneDirectory/AddContact
POST /PhoneDirectory/UpdateContact
POST /PhoneDirectory/DeleteContact



PROCEDURES

GET  /Procedures/GetProcedures
GET  /Procedures/SearchProcedures?query={query}
GET  /Procedures/DownloadProcedure?id={id}



SERVER ROOM MAPPING

GET  /ServerRoom/GetMaps
GET  /ServerRoom/GetRackDetails?rackId={id}
POST /ServerRoom/UpdateEquipmentLocation
POST /ServerRoom/AddConnection
POST /ServerRoom/UpdateConnection
POST /ServerRoom/DeleteConnection



MONITORING ALERTS

GET  /Monitoring/GetAlerts?severity={severity}&status={status}
POST /Monitoring/AddNote
POST /Monitoring/UpdateStatus
POST /Monitoring/BulkUpdateStatus



PLANNED CHANGES

GET  /Changes/GetChanges?startDate={date}&endDate={date}
GET /Changes/SyncWithONIT



USEFUL LINKS

GET  /Links/GetLinks
POST /Links/AddLink
POST /Links/UpdateLink
POST /Links/DeleteLink



🔧 INSTALLATION AND SETUP


PREREQUISITES

 * .NET Core SDK 6.0+
 * Visual Studio 2022 / VS Code
 * Modern browser (Chrome, Firefox, Edge)


RUNNING THE APPLICATION

 1. Open the project in Visual Studio
 2. Run the project: dotnet run
 3. Open browser at https://localhost:5001 [https://localhost:5001]


🔐 SECURITY

 * ✅ Server-side validation
 * ✅ CSRF Protection
 * ✅ Input Sanitization
 * ✅ Secure API endpoints


👨‍💻 DEVELOPMENT

The system is built with clean, maintainable code following best practices:

 * Modular JavaScript classes
 * Separation of concerns
 * Responsive design principles
 * Accessibility considerations


📝 LICENSE

Internal use - Menora Mivtachim

--------------------------------------------------------------------------------

Developed by Liron Golan | For Menora Mivtachim NOC Team |
Version 1.0