namespace ModelCycle.Services;

public sealed class BlobObjectInfo
{
    public BlobObjectInfo(string objectName, long size)
    {
        ObjectName = objectName;
        Size = size;
    }

    public string ObjectName { get; }
    public long Size { get; }
}
