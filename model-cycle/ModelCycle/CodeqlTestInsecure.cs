// CodeqlTestInsecure.cs
using System.Data.SqlClient;

public class CodeqlTestInsecure
{
    public void InsecureSql(string name, SqlConnection connection)
    {
        // INTENTIONALLY INSECURE (for CodeQL test): SQL injection via string concatenation
        var sql = "SELECT * FROM Users WHERE Name = '" + name + "'";
        using var cmd = new SqlCommand(sql, connection);
        cmd.ExecuteNonQuery();
    }
}
