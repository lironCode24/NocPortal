using Microsoft.AspNetCore.Hosting;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

public class EmployeeService
{
    private readonly string _employeesFilePath;

    public EmployeeService()
    {
        _employeesFilePath = Path.Combine(
            Directory.GetCurrentDirectory(),
            "assets",
            "files",
            "employees.txt"
        );
    }

    public EmployeeService(IWebHostEnvironment env)
    {
        _employeesFilePath = Path.Combine(
            env.WebRootPath,
            "assets",
            "files",
            "employees.txt"
        );
    }

    // Constructor for dependency injection with custom path
    public EmployeeService(string employeesFilePath)
    {
        _employeesFilePath = employeesFilePath;
    }

    /// <summary>
    /// Read all employees from the file
    /// </summary>
    /// <returns>List of employees</returns>
    public List<Employee> GetAllEmployees()
    {
        var employees = new List<Employee>();

        try
        {
            if (!File.Exists(_employeesFilePath))
            {
                return employees; // Return empty list if file doesn't exist
            }

            var lines = File.ReadAllLines(_employeesFilePath);
            
            foreach (var line in lines)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;

                try
                {
                    var employee = JsonSerializer.Deserialize<Employee>(line);
                    if (employee != null)
                    {
                        employees.Add(employee);
                    }
                }
                catch (JsonException)
                {
                    // Skip invalid JSON lines
                    continue;
                }
            }
        }
        catch (Exception ex)
        {
            throw new Exception($"Error reading employees file: {ex.Message}");
        }

        return employees;
    }

    /// <summary>
    /// Get employee by ID
    /// </summary>
    /// <param name="employeeId">Employee ID</param>
    /// <returns>Employee or null if not found</returns>
    public Employee GetEmployeeById(string employeeId)
    {
        if (string.IsNullOrEmpty(employeeId))
        {
            return null;
        }

        var employees = GetAllEmployees();
        return employees.FirstOrDefault(e => e.Id == employeeId);
    }

    /// <summary>
    /// Check if employee exists
    /// </summary>
    /// <param name="employeeId">Employee ID</param>
    /// <returns>True if employee exists</returns>
    public bool EmployeeExists(string employeeId)
    {
        return GetEmployeeById(employeeId) != null;
    }

    /// <summary>
    /// Add new employee to file
    /// </summary>
    /// <param name="employee">Employee to add</param>
    /// <returns>True if successful</returns>
    public bool AddEmployee(Employee employee)
    {
        try
        {
            if (employee == null || string.IsNullOrEmpty(employee.Id))
            {
                return false;
            }

            // Check if employee already exists
            if (EmployeeExists(employee.Id))
            {
                return false; // Employee already exists
            }

            var directory = Path.GetDirectoryName(_employeesFilePath);
            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var employeeJson = JsonSerializer.Serialize(employee);
            File.AppendAllLines(_employeesFilePath, new[] { employeeJson });
            
            return true;
        }
        catch (Exception ex)
        {
            throw new Exception($"Error adding employee to file: {ex.Message}");
        }
    }

    /// <summary>
    /// Update existing employee
    /// </summary>
    /// <param name="employee">Updated employee data</param>
    /// <returns>True if successful</returns>
    public bool UpdateEmployee(Employee employee)
    {
        try
        {
            if (employee == null || string.IsNullOrEmpty(employee.Id))
            {
                return false;
            }

            var employees = GetAllEmployees();
            var existingEmployee = employees.FirstOrDefault(e => e.Id == employee.Id);
            
            if (existingEmployee == null)
            {
                return false; // Employee not found
            }

            // Update employee data
            existingEmployee.Name = employee.Name;
            
            // Write all employees back to file
            WriteEmployeesToFile(employees);
            
            return true;
        }
        catch (Exception ex)
        {
            throw new Exception($"Error updating employee in file: {ex.Message}");
        }
    }

    /// <summary>
    /// Delete employee from file
    /// </summary>
    /// <param name="employeeId">Employee ID to delete</param>
    /// <returns>True if successful</returns>
    public bool DeleteEmployee(string employeeId)
    {
        try
        {
            if (string.IsNullOrEmpty(employeeId))
            {
                return false;
            }

            var employees = GetAllEmployees();
            var originalCount = employees.Count;
            
            employees = employees.Where(e => e.Id != employeeId).ToList();
            
            if (employees.Count < originalCount)
            {
                WriteEmployeesToFile(employees);
                return true;
            }

            return false; // Employee not found
        }
        catch (Exception ex)
        {
            throw new Exception($"Error deleting employee from file: {ex.Message}");
        }
    }

    /// <summary>
    /// Write employees list to file
    /// </summary>
    /// <param name="employees">List of employees</param>
    private void WriteEmployeesToFile(List<Employee> employees)
    {
        try
        {
            var directory = Path.GetDirectoryName(_employeesFilePath);
            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var lines = employees.Select(e => JsonSerializer.Serialize(e)).ToArray();
            File.WriteAllLines(_employeesFilePath, lines);
        }
        catch (Exception ex)
        {
            throw new Exception($"Error writing employees file: {ex.Message}");
        }
    }
}