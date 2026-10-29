with open(r'C:\Users\prasi\Desktop\Project\script.js', 'r') as f:
    lines = f.readlines()

depth = 0
for i, line in enumerate(lines, 1):
    # Track brace depth, ignoring braces inside strings (rough approximation)
    stripped = line.strip()
    
    # Count braces outside of strings
    in_string = False
    string_char = None
    open_count = 0
    close_count = 0
    
    for ch in line:
        if in_string:
            if ch == string_char:
                in_string = False
            elif ch == '\\':
                pass  # escaped char
            continue
        else:
            if ch in ('"', "'"):
                in_string = True
                string_char = ch
            elif ch == '{':
                open_count += 1
            elif ch == '}':
                close_count += 1
    
    if open_count > 0 or close_count > 0:
        depth += open_count - close_count
        print(f'Line {i:4d}: open={open_count} close={close_count} depth={depth} | {line[:70]}')

print(f'\nFinal depth: {depth}')