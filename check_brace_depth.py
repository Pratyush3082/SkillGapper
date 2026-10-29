with open(r'C:\Users\prasi\Desktop\Project\script.js', 'r') as f:
    content = f.read()

lines = content.split('\n')
depth = 0
max_depth = 0
for i, line in enumerate(lines, 1):
    # Count braces on this line (ignore strings roughly)
    open_count = line.count('{')
    close_count = line.count('}')
    
    depth += open_count - close_count
    
    if depth > max_depth:
        max_depth = depth
    
    # Show lines where depth changes significantly
    if open_count > 0 or close_count > 0:
        if abs(open_count - close_count) > 0:
            print(f'Line {i:4d}: depth change {open_count-close_count:+d} -> depth {depth:4d} | {line[:80]}')

print(f'\nFinal depth: {depth}')
print(f'Max depth reached: {max_depth}')