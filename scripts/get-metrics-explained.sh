#!/bin/bash

# Fetch metrics from the server
METRICS=$(curl -s -H "Authorization: Bearer default-api-key" http://localhost:9464/metrics)

# Process the metrics to show explanations and a few examples
echo "$METRICS" | awk '
BEGIN {
    current_help = ""
    current_type = ""
    example_count = 0
    max_examples = 3
}

# Capture HELP lines (explanations)
/^# HELP/ {
    if (current_help != "") {
        print ""
    }
    current_help = $0
    current_type = ""
    example_count = 0
    print current_help
    next
}

# Capture TYPE lines
/^# TYPE/ {
    current_type = $0
    print current_type
    next
}

# Skip other comment lines
/^#/ {
    next
}

# Print metric lines (limit to max_examples per metric type)
/^[a-zA-Z_]/ {
    if (current_help != "" && example_count < max_examples) {
        print $0
        example_count++
    }
    next
}

# Empty lines
/^$/ {
    if (current_help != "") {
        current_help = ""
        current_type = ""
        example_count = 0
    }
}
'
