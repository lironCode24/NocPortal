namespace NocPortal.Models
{
    public class DashboardPermission
    {
        public string DashboardId   { get; set; } = string.Empty;
        public string DashboardName { get; set; } = string.Empty;
    }

    public static class AvailableDashboards
    {
        public static readonly List<DashboardPermission> All = new()
        {
            new() { DashboardId = "alerts",        DashboardName = "NOC Events"      },
            new() { DashboardId = "rack-metrics",  DashboardName = "PDU Racks"       },
            new() { DashboardId = "suite-results", DashboardName = "Automation Results"  },
            new() { DashboardId = "employee-tasks", DashboardName = "Manage Tasks"  },
        };
    }
}